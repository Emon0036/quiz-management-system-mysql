require('dotenv').config();

const { connectMySql, sequelize } = require('../config/database');
const User = require('../models/User');
const Quiz = require('../models/Quiz');
const Question = require('../models/Question');
const Leaderboard = require('../models/Leaderboard');

const DEMO_PASSWORD = 'Demo@12345';

const demoTeachers = [
  {
    name: 'Dr. Ayesha Rahman',
    email: 'teacher.dbms@quizmaster.test',
    quiz: {
      title: 'DBMS Fundamentals Practice Exam',
      description: 'A clean demo exam covering keys, normalization, transactions, and SQL basics.',
      category: 'Database Systems',
      examType: 'quiz',
      difficulty: 'Medium',
      duration: 20,
      passingMarks: 60,
      questions: [
        {
          questionText: 'Which key uniquely identifies each row in a relational table?',
          type: 'multiple-choice',
          options: ['Foreign key', 'Primary key', 'Candidate group', 'Index key'],
          correctAnswer: 'Primary key',
          explanation: 'A primary key is selected to uniquely identify every record in a table.',
          marks: 2,
        },
        {
          questionText: 'Which normal form removes partial dependency from a relation?',
          type: 'multiple-choice',
          options: ['1NF', '2NF', '3NF', 'BCNF'],
          correctAnswer: '2NF',
          explanation: 'Second normal form removes partial dependencies on part of a composite key.',
          marks: 2,
        },
        {
          questionText: 'What does ACID stand for in transaction management?',
          type: 'multiple-choice',
          options: [
            'Atomicity, Consistency, Isolation, Durability',
            'Accuracy, Control, Indexing, Data',
            'Atomicity, Commit, Isolation, Database',
            'Access, Consistency, Input, Durability',
          ],
          correctAnswer: 'Atomicity, Consistency, Isolation, Durability',
          explanation: 'ACID describes the core reliability properties of database transactions.',
          marks: 2,
        },
        {
          questionText: 'Which SQL command is used to remove all rows from a table while keeping the table structure?',
          type: 'multiple-choice',
          options: ['DROP', 'TRUNCATE', 'DELETE DATABASE', 'REMOVE TABLE'],
          correctAnswer: 'TRUNCATE',
          explanation: 'TRUNCATE clears table rows but keeps the table definition.',
          marks: 2,
        },
        {
          questionText: 'A foreign key usually references which key in another table?',
          type: 'multiple-choice',
          options: ['Primary key', 'Alternate index', 'Temporary key', 'Composite view'],
          correctAnswer: 'Primary key',
          explanation: 'Foreign keys commonly reference a primary key to maintain relationships.',
          marks: 2,
        },
      ],
    },
  },
  {
    name: 'Prof. Karim Hasan',
    email: 'teacher.web@quizmaster.test',
    quiz: {
      title: 'Web Development True/False Check',
      description: 'A fast demo exam for HTML, CSS, JavaScript, and browser behavior.',
      category: 'Web Development',
      examType: 'true-false',
      difficulty: 'Easy',
      duration: 12,
      passingMarks: 60,
      questions: [
        {
          questionText: 'HTML is mainly responsible for the structure of a web page.',
          type: 'true-false',
          options: ['True', 'False'],
          correctAnswer: 'True',
          explanation: 'HTML defines document structure and semantic content.',
          marks: 2,
        },
        {
          questionText: 'CSS is used only for storing database records.',
          type: 'true-false',
          options: ['True', 'False'],
          correctAnswer: 'False',
          explanation: 'CSS controls presentation and layout, not database storage.',
          marks: 2,
        },
        {
          questionText: 'JavaScript can respond to user events in the browser.',
          type: 'true-false',
          options: ['True', 'False'],
          correctAnswer: 'True',
          explanation: 'JavaScript is commonly used for event-driven browser interactions.',
          marks: 2,
        },
        {
          questionText: 'Responsive design helps pages adapt to different screen sizes.',
          type: 'true-false',
          options: ['True', 'False'],
          correctAnswer: 'True',
          explanation: 'Responsive layouts improve usability on mobile, tablet, and desktop screens.',
          marks: 2,
        },
        {
          questionText: 'The browser DOM cannot be changed after a page loads.',
          type: 'true-false',
          options: ['True', 'False'],
          correctAnswer: 'False',
          explanation: 'Client-side scripts can update the DOM after page load.',
          marks: 2,
        },
      ],
    },
  },
  {
    name: 'Engr. Nusrat Jahan',
    email: 'teacher.coding@quizmaster.test',
    quiz: {
      title: 'JavaScript Coding Exam Demo',
      description: 'A coding-focused demo exam that shows the new IDE-style answer section.',
      category: 'Programming',
      examType: 'coding-test',
      difficulty: 'Medium',
      duration: 30,
      passingMarks: 60,
      questions: [
        {
          questionText: 'Write a JavaScript function named sumArray that returns the sum of all numbers in an array.',
          type: 'coding',
          language: 'javascript',
          codeTemplate: 'function sumArray(numbers) {\n  // write your solution here\n}\n',
          correctAnswer: 'function sumArray(numbers) {\n  return numbers.reduce((sum, value) => sum + value, 0);\n}',
          testCases: [
            { input: '[1, 2, 3, 4]', expectedOutput: '10' },
            { input: '[-2, 5, 7]', expectedOutput: '10' },
          ],
          marks: 10,
        },
        {
          questionText: 'Write a JavaScript function named isPalindrome that returns true when a string reads the same backward.',
          type: 'coding',
          language: 'javascript',
          codeTemplate: 'function isPalindrome(text) {\n  // write your solution here\n}\n',
          correctAnswer:
            "function isPalindrome(text) {\n  const normalized = String(text).toLowerCase().replace(/[^a-z0-9]/g, '');\n  return normalized === normalized.split('').reverse().join('');\n}",
          testCases: [
            { input: 'madam', expectedOutput: 'true' },
            { input: 'hello', expectedOutput: 'false' },
          ],
          marks: 10,
        },
        {
          questionText: 'Write a JavaScript function named countVowels that returns the number of vowels in a string.',
          type: 'coding',
          language: 'javascript',
          codeTemplate: 'function countVowels(text) {\n  // write your solution here\n}\n',
          correctAnswer: "function countVowels(text) {\n  return (String(text).match(/[aeiou]/gi) || []).length;\n}",
          testCases: [
            { input: 'Database', expectedOutput: '4' },
            { input: 'QuizMaster', expectedOutput: '3' },
          ],
          marks: 10,
        },
      ],
    },
  },
];

async function upsertTeacherAccount({ name, email }) {
  const normalizedEmail = email.toLowerCase();
  let teacher = await User.findOne({ email: normalizedEmail });

  if (!teacher) {
    teacher = await User.create({
      name,
      email: normalizedEmail,
      password: DEMO_PASSWORD,
      role: 'teacher',
      teacherStatus: 'approved',
      accountStatus: 'active',
      approvedAt: new Date(),
    });
    return teacher;
  }

  teacher.name = name;
  teacher.password = DEMO_PASSWORD;
  teacher.role = 'teacher';
  teacher.teacherStatus = 'approved';
  teacher.accountStatus = 'active';
  teacher.approvedAt = teacher.approvedAt || new Date();
  await teacher.save();

  return teacher;
}

async function recreateQuizForTeacher(teacher, quizData) {
  let quiz = await Quiz.findOne({ createdBy: teacher._id, title: quizData.title });

  if (!quiz) {
    quiz = await Quiz.create({
      title: quizData.title,
      description: quizData.description,
      category: quizData.category,
      examType: quizData.examType,
      difficulty: quizData.difficulty,
      duration: quizData.duration,
      passingMarks: quizData.passingMarks,
      totalMarks: 0,
      createdBy: teacher._id,
      questions: [],
      status: 'published',
    });
  } else {
    Object.assign(quiz, {
      description: quizData.description,
      category: quizData.category,
      examType: quizData.examType,
      difficulty: quizData.difficulty,
      duration: quizData.duration,
      passingMarks: quizData.passingMarks,
      status: 'published',
    });
    await Question.deleteMany({ quiz: quiz._id });
  }

  const questions = [];
  for (const questionData of quizData.questions) {
    const question = await Question.create({
      quiz: quiz._id,
      options: [],
      explanation: '',
      correctAnswer: '',
      codeTemplate: '',
      language: '',
      testCases: [],
      ...questionData,
    });
    questions.push(question);
  }

  quiz.questions = questions.map((question) => question._id);
  quiz.totalMarks = questions.reduce((sum, question) => sum + Number(question.marks || 0), 0);
  quiz.status = 'published';
  await quiz.save();

  await Leaderboard.findOneAndUpdate(
    { quiz: quiz._id },
    { $setOnInsert: { quiz: quiz._id, entries: [] } },
    { upsert: true }
  );

  return { quiz, questions };
}

async function seedDemoTeachers() {
  await connectMySql();

  const created = [];
  for (const teacherData of demoTeachers) {
    const teacher = await upsertTeacherAccount(teacherData);
    const { quiz, questions } = await recreateQuizForTeacher(teacher, teacherData.quiz);
    created.push({ teacher, quiz, questionCount: questions.length });
  }

  console.log('\nDemo teacher accounts are ready.');
  console.log(`Password for all demo teachers: ${DEMO_PASSWORD}\n`);
  created.forEach(({ teacher, quiz, questionCount }, index) => {
    console.log(`${index + 1}. ${teacher.name}`);
    console.log(`   Email: ${teacher.email}`);
    console.log(`   Exam: ${quiz.title} (${questionCount} questions, ${quiz.totalMarks} marks, published)`);
  });
}

seedDemoTeachers()
  .catch((error) => {
    console.error('Failed to seed demo teachers:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sequelize.close();
  });
