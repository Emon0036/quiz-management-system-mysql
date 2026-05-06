```markdown
# Online-quiz-management-system Development Patterns

> Auto-generated skill from repository analysis

## Overview
This skill teaches you the development patterns and conventions used in the "Online-quiz-management-system" JavaScript codebase. You'll learn how to structure files, write and organize code, and follow the project's conventions for imports, exports, and testing. This guide is ideal for contributors who want to maintain consistency and quality in their work.

## Coding Conventions

### File Naming
- Use **camelCase** for file names.
  - Example: `quizManager.js`, `userController.js`

### Import Style
- Use **relative imports** for modules within the project.
  - Example:
    ```javascript
    import { getQuizList } from './quizManager';
    ```

### Export Style
- Use **named exports** for functions, classes, and constants.
  - Example:
    ```javascript
    // quizManager.js
    export function getQuizList() { ... }
    export const QUIZ_LIMIT = 10;
    ```

### Commit Messages
- Commit messages are **freeform** (no enforced prefixes).
- Average length: ~55 characters.
  - Example:  
    ```
    Add timer functionality to quiz component
    ```

## Workflows

### Adding a New Feature
**Trigger:** When implementing a new feature or module  
**Command:** `/add-feature`

1. Create a new file using camelCase naming (e.g., `featureName.js`).
2. Implement your feature using named exports.
3. Import any dependencies using relative paths.
4. Write associated tests in a file named `featureName.test.js`.
5. Commit your changes with a clear, descriptive message.

### Fixing a Bug
**Trigger:** When resolving a bug or issue  
**Command:** `/fix-bug`

1. Locate the relevant file(s) using camelCase conventions.
2. Apply your fix, maintaining the import/export style.
3. Update or add tests in the corresponding `.test.js` file to cover the fix.
4. Commit with a message describing the bug and the fix.

### Writing and Running Tests
**Trigger:** When verifying code correctness  
**Command:** `/run-tests`

1. Write tests in files matching the `*.test.*` pattern (e.g., `quizManager.test.js`).
2. Use the project's preferred (unknown) testing framework.
3. Run tests using the project's test runner (consult project docs if unsure).
4. Ensure all tests pass before merging changes.

## Testing Patterns

- Test files follow the `*.test.*` naming pattern.
  - Example: `quizManager.test.js`
- The specific testing framework is **unknown**; check project documentation or existing test files for details.
- Tests should cover all exported functions and critical logic.

  ```javascript
  // quizManager.test.js
  import { getQuizList } from './quizManager';

  test('getQuizList returns an array', () => {
    expect(Array.isArray(getQuizList())).toBe(true);
  });
  ```

## Commands
| Command       | Purpose                                 |
|---------------|-----------------------------------------|
| /add-feature  | Scaffold and implement a new feature    |
| /fix-bug      | Apply and document a bug fix            |
| /run-tests    | Run the test suite for the codebase     |
```
