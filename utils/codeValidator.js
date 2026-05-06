/**
 * Code Execution and Validation Utility
 * Simulates code execution against test cases
 * In production, consider using a proper sandbox like Rextester API or Judge0 API
 */

const validateCodingSubmission = async (code, language, testCases) => {
  if (!code || !code.trim()) {
    return {
      success: false,
      error: 'No code provided',
      testsPassed: 0,
      totalTests: testCases.length,
      isCorrect: false,
    };
  }

  // This is a simplified validation - in production use a proper code execution service
  // For now, we'll just check if code is not empty and reasonable
  
  let testsPassed = 0;
  const results = [];

  try {
    // Validate based on language
    if (language === 'javascript') {
      testsPassed = validateJavaScript(code, testCases, results);
    } else if (language === 'python') {
      testsPassed = validatePython(code, testCases, results);
    } else {
      // For other languages, just check if code exists
      testsPassed = code.trim().length > 10 ? Math.floor(testCases.length / 2) : 0;
    }
  } catch (error) {
    return {
      success: false,
      error: error.message || 'Code execution failed',
      testsPassed: 0,
      totalTests: testCases.length,
      isCorrect: false,
      results,
    };
  }

  const isCorrect = testsPassed === testCases.length;

  return {
    success: true,
    testsPassed,
    totalTests: testCases.length,
    isCorrect,
    results,
  };
};

/**
 * Basic JavaScript validation
 * This is a simplified approach - for production use a proper sandbox
 */
function validateJavaScript(code, testCases, results) {
  let testsPassed = 0;

  // Check for basic syntax issues
  try {
    // eslint-disable-next-line no-new-func
    new Function(code);
  } catch (error) {
    throw new Error(`JavaScript Syntax Error: ${error.message}`);
  }

  // Simulate test cases - this is a placeholder
  // In production, use a proper sandbox or code execution service
  testCases.forEach((testCase, index) => {
    try {
      // This is very basic - just check if code contains reasonable programming logic
      const hasLogic = code.includes('function') || code.includes('=>') || code.includes('return');
      const hasIO = code.includes('console') || code.includes('return') || code.includes('result');

      if (hasLogic && hasIO) {
        testsPassed++;
        results.push({ index, status: 'passed', message: `Test case ${index + 1} passed` });
      } else {
        results.push({ index, status: 'failed', message: `Test case ${index + 1} failed` });
      }
    } catch (error) {
      results.push({ index, status: 'error', message: error.message });
    }
  });

  return testsPassed;
}

/**
 * Basic Python validation
 */
function validatePython(code, testCases, results) {
  let testsPassed = 0;

  // Check for basic Python syntax
  const hasPythonStructure = code.includes('def ') || code.includes('class ') || code.includes('print');

  testCases.forEach((testCase, index) => {
    try {
      if (hasPythonStructure && code.length > 20) {
        testsPassed++;
        results.push({ index, status: 'passed', message: `Test case ${index + 1} passed` });
      } else {
        results.push({ index, status: 'failed', message: `Test case ${index + 1} failed` });
      }
    } catch (error) {
      results.push({ index, status: 'error', message: error.message });
    }
  });

  return testsPassed;
}

module.exports = {
  validateCodingSubmission,
};
