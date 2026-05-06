(function initProblemForm() {
  const container = document.getElementById('testCasesContainer');
  const addButton = document.getElementById('addTestCase');
  if (!container || !addButton) return;

  function currentCount() {
    return container.querySelectorAll('[data-test-case]').length;
  }

  function buildTestCaseHtml(index) {
    return `
      <div class="border rounded p-3 mb-3" data-test-case>
        <div class="d-flex justify-content-between align-items-center mb-2">
          <strong>Test Case #${index + 1}</strong>
          <button type="button" class="btn btn-sm btn-outline-danger remove-test-case">
            <i class="fa-solid fa-trash me-1"></i>Remove
          </button>
        </div>
        <div class="row g-2">
          <div class="col-lg-6">
            <label class="form-label small text-muted">Input</label>
            <textarea class="form-control font-monospace" name="testCases[${index}][input]" rows="3" placeholder="Input for this test case"></textarea>
          </div>
          <div class="col-lg-6">
            <label class="form-label small text-muted">Expected Output</label>
            <textarea class="form-control font-monospace" name="testCases[${index}][expectedOutput]" rows="3" placeholder="Expected output"></textarea>
          </div>
        </div>
      </div>
    `;
  }

  function renumberVisibleCases() {
    const items = Array.from(container.querySelectorAll('[data-test-case]'));
    items.forEach((item, index) => {
      const heading = item.querySelector('strong');
      if (heading) heading.textContent = `Test Case #${index + 1}`;

      const inputArea = item.querySelector('textarea[name*="[input]"]');
      if (inputArea) inputArea.name = `testCases[${index}][input]`;

      const expectedArea = item.querySelector('textarea[name*="[expectedOutput]"]');
      if (expectedArea) expectedArea.name = `testCases[${index}][expectedOutput]`;
    });
  }

  addButton.addEventListener('click', () => {
    const index = currentCount();
    container.insertAdjacentHTML('beforeend', buildTestCaseHtml(index));
    renumberVisibleCases();
  });

  container.addEventListener('click', (event) => {
    const button = event.target.closest('.remove-test-case');
    if (!button) return;
    const item = button.closest('[data-test-case]');
    if (!item) return;
    item.remove();
    renumberVisibleCases();
  });
})();
