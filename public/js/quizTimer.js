const timer = document.querySelector('.timer');
const quizForm = document.getElementById('quizForm');
const timerText = document.getElementById('timerText');
const timeSpent = document.getElementById('timeSpent');
const autoSubmitted = document.getElementById('autoSubmitted');
const autoSubmitReason = document.getElementById('autoSubmitReason');
const securityTrialsText = document.getElementById('securityTrialsText');
const securityRecoveryText = document.getElementById('securityRecoveryText');
const securityWarningText = document.getElementById('securityWarningText');

if (timer && quizForm && timerText) {
  const totalSeconds = Number(timer.dataset.duration) * 60;
  const startedAt = Date.now();
  const originalTitle = document.title;
  const maxSecurityTrials = 3;
  const recoverySeconds = 15;
  const storageKey = `quiz-security:${quizForm.action || window.location.pathname}`;
  let remaining = totalSeconds;
  let alreadySubmitted = false;
  let usedSecurityTrials = readSavedSecurityTrials();
  let activeRecovery = readSavedRecovery();
  let interval = null;
  let focusCheckInterval = null;
  let recoveryInterval = null;
  let lastIncident = { group: '', at: 0 };
  const clipboardShortcutReasons = {
    c: 'clipboard_copy_shortcut',
    v: 'clipboard_paste_shortcut',
    x: 'clipboard_cut_shortcut',
  };
  const reasonLabels = {
    clipboard_copy: 'Copying is not allowed during the exam',
    clipboard_copy_shortcut: 'Copy shortcut is not allowed during the exam',
    clipboard_cut: 'Cutting is not allowed during the exam',
    clipboard_cut_shortcut: 'Cut shortcut is not allowed during the exam',
    clipboard_paste: 'Pasting is not allowed during the exam',
    clipboard_paste_shortcut: 'Paste shortcut is not allowed during the exam',
    context_menu: 'Right-click is not allowed during the exam',
    dev_tools_attempted: 'Developer tools are not allowed during the exam',
    focus_lost: 'The exam window lost focus',
    tab_hidden: 'You switched away from the exam tab',
    window_blur: 'You switched away from the exam window',
  };

  function getSavedSecurityState() {
    try {
      return JSON.parse(sessionStorage.getItem(storageKey) || '{}');
    } catch {
      return {};
    }
  }

  function readSavedSecurityTrials() {
    const savedTrials = Number(getSavedSecurityState().usedSecurityTrials || 0);
    if (!Number.isFinite(savedTrials)) return 0;
    return Math.max(0, Math.min(maxSecurityTrials, savedTrials));
  }

  function readSavedRecovery() {
    const savedState = getSavedSecurityState();
    const startedAtMs = Number(savedState.recoveryStartedAt || 0);
    if (!Number.isFinite(startedAtMs) || startedAtMs <= 0) return null;
    return {
      startedAt: startedAtMs,
      reason: savedState.recoveryReason || 'focus_lost',
    };
  }

  function saveSecurityState() {
    try {
      sessionStorage.setItem(
        storageKey,
        JSON.stringify({
          usedSecurityTrials,
          recoveryStartedAt: activeRecovery ? activeRecovery.startedAt : null,
          recoveryReason: activeRecovery ? activeRecovery.reason : '',
        })
      );
    } catch {}
  }

  function clearSecurityState() {
    try {
      sessionStorage.removeItem(storageKey);
    } catch {}
  }

  function pluralizeChance(count) {
    return count === 1 ? 'chance' : 'chances';
  }

  function formatClock(seconds) {
    const safeSeconds = Math.max(0, seconds);
    const minutes = Math.floor(safeSeconds / 60);
    const paddedSeconds = String(safeSeconds % 60).padStart(2, '0');
    return `${minutes}:${paddedSeconds}`;
  }

  function getRecoveryRemaining() {
    if (!activeRecovery) return recoverySeconds;
    const elapsed = Math.floor((Date.now() - activeRecovery.startedAt) / 1000);
    return Math.max(0, recoverySeconds - elapsed);
  }

  function setSecurityMessage(message, tone) {
    if (!securityWarningText) return;

    securityWarningText.textContent = message;
    securityWarningText.dataset.tone = tone || 'warning';
    securityWarningText.classList.remove('d-none');
  }

  function updateSecurityStatus() {
    const chancesLeft = Math.max(0, maxSecurityTrials - usedSecurityTrials);

    if (securityTrialsText) {
      securityTrialsText.textContent = `${chancesLeft} ${pluralizeChance(chancesLeft)} left`;
      securityTrialsText.classList.toggle('is-danger', chancesLeft === 0);
    }

    if (securityRecoveryText) {
      if (activeRecovery) {
        securityRecoveryText.textContent = `Return window: ${formatClock(getRecoveryRemaining())}`;
        securityRecoveryText.classList.remove('d-none');
      } else {
        securityRecoveryText.classList.add('d-none');
      }
    }

    document.title = activeRecovery ? `Return ${formatClock(getRecoveryRemaining())} - ${originalTitle}` : originalTitle;
  }

  function getCursorPosition(editor) {
    const cursorIndex = editor.selectionStart || 0;
    const beforeCursor = editor.value.slice(0, cursorIndex);
    const line = beforeCursor.split('\n').length;
    const column = cursorIndex - beforeCursor.lastIndexOf('\n');

    return { line, column };
  }

  function updateEditorChrome(editor) {
    const shell = editor.closest('[data-code-ide]');
    if (!shell) return;

    const gutter = shell.querySelector('[data-code-gutter]');
    const lineSummary = shell.querySelector('[data-code-lines]');
    const cursorStatus = shell.querySelector('[data-code-cursor]');
    const lineCount = Math.max(1, editor.value.split('\n').length);

    if (gutter) {
      gutter.textContent = Array.from({ length: lineCount }, (_, index) => index + 1).join('\n');
      gutter.scrollTop = editor.scrollTop;
    }

    if (lineSummary) {
      lineSummary.textContent = `${lineCount} line${lineCount === 1 ? '' : 's'}`;
    }

    if (cursorStatus) {
      const cursor = getCursorPosition(editor);
      cursorStatus.textContent = `Ln ${cursor.line}, Col ${cursor.column}`;
    }
  }

  function insertIndent(editor) {
    const indent = '  ';
    const start = editor.selectionStart || 0;
    const end = editor.selectionEnd || start;
    const value = editor.value;

    if (start !== end) {
      const lineStart = value.lastIndexOf('\n', start - 1) + 1;
      const selectedBlock = value.slice(lineStart, end);
      const indentedBlock = selectedBlock
        .split('\n')
        .map((line) => `${indent}${line}`)
        .join('\n');

      editor.value = `${value.slice(0, lineStart)}${indentedBlock}${value.slice(end)}`;
      editor.selectionStart = start + indent.length;
      editor.selectionEnd = lineStart + indentedBlock.length;
    } else {
      editor.value = `${value.slice(0, start)}${indent}${value.slice(end)}`;
      editor.selectionStart = start + indent.length;
      editor.selectionEnd = start + indent.length;
    }

    editor.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function setupCodeEditors() {
    document.querySelectorAll('[data-code-editor]').forEach((editor) => {
      const shell = editor.closest('[data-code-ide]');
      const gutter = shell ? shell.querySelector('[data-code-gutter]') : null;
      const refresh = () => updateEditorChrome(editor);

      editor.addEventListener('input', refresh);
      editor.addEventListener('keyup', refresh);
      editor.addEventListener('click', refresh);
      editor.addEventListener('select', refresh);
      editor.addEventListener('scroll', () => {
        if (gutter) gutter.scrollTop = editor.scrollTop;
      });
      editor.addEventListener('focus', () => {
        if (shell) shell.classList.add('is-focused');
        refresh();
      });
      editor.addEventListener('blur', () => {
        if (shell) shell.classList.remove('is-focused');
      });
      editor.addEventListener('keydown', (event) => {
        if (event.key !== 'Tab') return;

        event.preventDefault();
        insertIndent(editor);
      });

      refresh();
    });
  }

  function syncTimeSpent() {
    if (!timeSpent) return;
    timeSpent.value = Math.min(totalSeconds, Math.floor((Date.now() - startedAt) / 1000));
  }

  function submitNow(reason) {
    if (alreadySubmitted) return;
    alreadySubmitted = true;

    syncTimeSpent();
    if (autoSubmitted) autoSubmitted.value = '1';
    if (autoSubmitReason) autoSubmitReason.value = String(reason || 'focus_lost');

    clearInterval(interval);
    clearInterval(focusCheckInterval);
    clearInterval(recoveryInterval);
    clearSecurityState();
    document.title = originalTitle;

    // Use native submit for automatic submission so required validation does not block it.
    quizForm.noValidate = true;
    quizForm.submit();
  }

  function incidentGroup(reason) {
    if (String(reason).startsWith('clipboard_copy')) return 'clipboard_copy';
    if (String(reason).startsWith('clipboard_cut')) return 'clipboard_cut';
    if (String(reason).startsWith('clipboard_paste')) return 'clipboard_paste';
    return reason;
  }

  function isDuplicateIncident(reason) {
    const group = incidentGroup(reason);
    const now = Date.now();

    if (lastIncident.group === group && now - lastIncident.at < 700) {
      return true;
    }

    lastIncident = { group, at: now };
    return false;
  }

  function useSecurityTrial(reason) {
    if (usedSecurityTrials >= maxSecurityTrials) {
      submitNow(reason);
      return false;
    }

    usedSecurityTrials += 1;
    saveSecurityState();
    updateSecurityStatus();

    const chancesLeft = Math.max(0, maxSecurityTrials - usedSecurityTrials);
    const reasonLabel = reasonLabels[reason] || 'An exam security rule was triggered';
    const remainingText = chancesLeft > 0
      ? `${chancesLeft} ${pluralizeChance(chancesLeft)} left.`
      : 'No warning chances remain. The next security incident will auto-submit the exam.';

    setSecurityMessage(`${reasonLabel}. Warning ${usedSecurityTrials} of ${maxSecurityTrials} used. ${remainingText}`, 'warning');
    return true;
  }

  function registerSecurityIncident(event, reason) {
    if (event) event.preventDefault();
    if (alreadySubmitted || isDuplicateIncident(reason)) return;

    useSecurityTrial(reason);
  }

  function stopRecovery() {
    activeRecovery = null;
    clearInterval(recoveryInterval);
    recoveryInterval = null;
    saveSecurityState();
    updateSecurityStatus();
  }

  function finishRecoveryIfReturned() {
    if (!activeRecovery || alreadySubmitted) return;

    if (getRecoveryRemaining() <= 0) {
      submitNow('security_recovery_timeout');
      return;
    }

    stopRecovery();

    const chancesLeft = Math.max(0, maxSecurityTrials - usedSecurityTrials);
    const remainingText = chancesLeft > 0
      ? `${chancesLeft} ${pluralizeChance(chancesLeft)} left.`
      : 'No warning chances remain. The next security incident will auto-submit the exam.';

    setSecurityMessage(`You returned within the 15 second window. ${remainingText}`, 'success');
  }

  function checkRecoveryTimeout() {
    if (!activeRecovery || alreadySubmitted) return;

    if (getRecoveryRemaining() <= 0) {
      submitNow('security_recovery_timeout');
      return;
    }

    updateSecurityStatus();
  }

  function startRecovery(reason) {
    if (alreadySubmitted) return;

    if (activeRecovery) {
      checkRecoveryTimeout();
      return;
    }

    if (!useSecurityTrial(reason)) return;

    activeRecovery = {
      startedAt: Date.now(),
      reason,
    };
    saveSecurityState();
    updateSecurityStatus();

    setSecurityMessage('You left the exam tab or window. Return within 15 seconds to continue, otherwise the exam will auto-submit.', 'danger');

    clearInterval(recoveryInterval);
    recoveryInterval = setInterval(checkRecoveryTimeout, 1000);
  }

  // Timer countdown
  interval = setInterval(() => {
    remaining -= 1;
    const minutes = Math.floor(remaining / 60);
    const seconds = String(remaining % 60).padStart(2, '0');
    timerText.textContent = `${minutes}:${seconds}`;
    syncTimeSpent();

    if (remaining <= 60) timer.classList.add('timer-danger');
    if (remaining <= 0) {
      submitNow('time_up');
    }
  }, 1000);

  // Continuous focus monitor for tabs, notifications, and app switches
  focusCheckInterval = setInterval(() => {
    if (alreadySubmitted) return;
    if (!document.hasFocus() || document.visibilityState !== 'visible') {
      startRecovery('focus_lost');
    }
  }, 500);

  quizForm.addEventListener('submit', () => {
    alreadySubmitted = true;
    syncTimeSpent();
    clearSecurityState();
    document.title = originalTitle;
  });

  setupCodeEditors();
  updateSecurityStatus();

  if (activeRecovery) {
    if (getRecoveryRemaining() <= 0) {
      submitNow('security_recovery_timeout');
    } else if (document.visibilityState === 'visible' && document.hasFocus()) {
      finishRecoveryIfReturned();
    } else {
      recoveryInterval = setInterval(checkRecoveryTimeout, 1000);
    }
  }

  // Tab visibility change - start a 15 second return window when hidden
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && !alreadySubmitted) {
      startRecovery('tab_hidden');
      return;
    }

    if (!document.hidden) {
      finishRecoveryIfReturned();
    }
  });

  // Window blur - start a 15 second return window when the student switches apps/windows
  window.addEventListener('blur', () => {
    if (!alreadySubmitted) {
      startRecovery('window_blur');
    }
  });

  window.addEventListener('focus', finishRecoveryIfReturned);

  // Fallback for modern browsers when page is hidden or closed
  window.addEventListener('pagehide', (event) => {
    if (!alreadySubmitted && !event.persisted) submitNow('page_hide');
  });

  // Prevent right-click and developer tools opening
  document.addEventListener('keydown', (e) => {
    const key = String(e.key || '').toLowerCase();

    // F12, Ctrl+Shift+I, Ctrl+Shift+J, Ctrl+Shift+C
    if (e.key === 'F12' || (e.ctrlKey && e.shiftKey && ['i', 'j', 'c'].includes(key))) {
      registerSecurityIncident(e, 'dev_tools_attempted');
      return;
    }

    // Copy, cut, and paste shortcuts are treated as exam security violations.
    if ((e.ctrlKey || e.metaKey) && clipboardShortcutReasons[key]) {
      registerSecurityIncident(e, clipboardShortcutReasons[key]);
      return;
    }

    // Common alternate clipboard shortcuts on Windows/Linux keyboards.
    if (e.shiftKey && key === 'insert') {
      registerSecurityIncident(e, 'clipboard_paste_shortcut');
      return;
    }

    if (e.ctrlKey && key === 'insert') {
      registerSecurityIncident(e, 'clipboard_copy_shortcut');
    }
  });

  document.addEventListener(
    'copy',
    (e) => {
      registerSecurityIncident(e, 'clipboard_copy');
    },
    true
  );

  document.addEventListener(
    'cut',
    (e) => {
      registerSecurityIncident(e, 'clipboard_cut');
    },
    true
  );

  document.addEventListener(
    'paste',
    (e) => {
      registerSecurityIncident(e, 'clipboard_paste');
    },
    true
  );

  document.addEventListener(
    'beforeinput',
    (e) => {
      if (['insertFromPaste', 'insertFromPasteAsQuotation'].includes(e.inputType)) {
        registerSecurityIncident(e, 'clipboard_paste');
      }
    },
    true
  );

  document.addEventListener('contextmenu', (e) => {
    registerSecurityIncident(e, 'context_menu');
  });

  // Warn before closing/navigating away
  window.addEventListener('beforeunload', (e) => {
    if (!alreadySubmitted) {
      e.preventDefault();
      e.returnValue = 'Leaving this exam page may auto-submit your exam.';
    }
  });

  // Prevent back button
  history.pushState(null, null, window.location.href);
  window.addEventListener('popstate', () => {
    history.pushState(null, null, window.location.href);
  });
}

