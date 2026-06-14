const mysql = require('mysql2/promise');
const { Sequelize, DataTypes } = require('sequelize');
const { createTeacherCode } = require('../utils/teacherCode');

const databaseConfig = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  database: process.env.DB_NAME || 'quiz_management_system',
  username: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
};

const sequelize = new Sequelize(
  databaseConfig.database,
  databaseConfig.username,
  databaseConfig.password,
  {
    host: databaseConfig.host,
    port: databaseConfig.port,
    dialect: 'mysql',
    logging: process.env.DB_LOGGING === 'true' ? console.log : false,
    define: {
      freezeTableName: true,
      underscored: false,
    },
  }
);

function getSessionMaxAgeMs() {
  const configuredDays = Number(process.env.SESSION_MAX_AGE_DAYS || 30);
  const days = Number.isFinite(configuredDays) && configuredDays > 0 ? configuredDays : 30;
  return days * 24 * 60 * 60 * 1000;
}

function escapeIdentifier(identifier) {
  return `\`${String(identifier).replace(/`/g, '``')}\``;
}

async function ensureColumn(tableName, columnName, definition) {
  const queryInterface = sequelize.getQueryInterface();
  const table = await queryInterface.describeTable(tableName);
  if (!table[columnName]) {
    await queryInterface.addColumn(tableName, columnName, definition);
  }
}

async function ensureIndex(tableName, indexName, fields, options = {}) {
  const queryInterface = sequelize.getQueryInterface();
  const indexes = await queryInterface.showIndex(tableName);
  const existingIndex = indexes.find((index) => {
    const indexFields = Array.isArray(index.fields)
      ? index.fields.map((field) => field.attribute || field.name)
      : [index.columnName].filter(Boolean);
    const isSameName = index.name === indexName;
    const isSameFields = indexFields.length === fields.length && indexFields.every((field, index) => field === fields[index]);
    const isUnique = index.unique === true || index.nonUnique === false || index.Non_unique === 0;
    return isSameName || (isSameFields && (!options.unique || isUnique));
  });

  if (!existingIndex) {
    await queryInterface.addIndex(tableName, fields, { name: indexName, unique: Boolean(options.unique) });
  }
}

const FOREIGN_KEY_DEFINITIONS = [
  ['users', 'approvedBy', 'users', 'fk_users_approved_by', 'SET NULL'],
  ['users', 'blockedBy', 'users', 'fk_users_blocked_by', 'SET NULL'],
  ['admins', 'user', 'users', 'fk_admins_user', 'CASCADE'],
  ['admins', 'createdBy', 'users', 'fk_admins_created_by', 'SET NULL'],
  ['quizzes', 'createdBy', 'users', 'fk_quizzes_created_by', 'CASCADE'],
  ['questions', 'quiz', 'quizzes', 'fk_questions_quiz', 'CASCADE'],
  ['attempts', 'student', 'users', 'fk_attempts_student', 'CASCADE'],
  ['attempts', 'quiz', 'quizzes', 'fk_attempts_quiz', 'CASCADE'],
  ['results', 'student', 'users', 'fk_results_student', 'CASCADE'],
  ['results', 'quiz', 'quizzes', 'fk_results_quiz', 'CASCADE'],
  ['results', 'attempt', 'attempts', 'fk_results_attempt', 'CASCADE'],
  ['enrollments', 'student', 'users', 'fk_enrollments_student', 'CASCADE'],
  ['enrollments', 'quiz', 'quizzes', 'fk_enrollments_quiz', 'CASCADE'],
  ['enrollments', 'bestAttemptId', 'attempts', 'fk_enrollments_best_attempt', 'SET NULL'],
  ['progress', 'student', 'users', 'fk_progress_student', 'CASCADE'],
  ['global_leaderboards', 'student', 'users', 'fk_global_leaderboards_student', 'CASCADE'],
  ['leaderboards', 'quiz', 'quizzes', 'fk_leaderboards_quiz', 'CASCADE'],
  ['exam_roster_entries', 'teacher', 'users', 'fk_exam_roster_teacher', 'CASCADE'],
  ['exam_roster_entries', 'quiz', 'quizzes', 'fk_exam_roster_quiz', 'CASCADE'],
  ['exam_roster_entries', 'student', 'users', 'fk_exam_roster_student', 'SET NULL'],
  ['problems', 'createdBy', 'users', 'fk_problems_created_by', 'SET NULL'],
  ['submissions', 'problem', 'problems', 'fk_submissions_problem', 'CASCADE'],
  ['submissions', 'student', 'users', 'fk_submissions_student', 'CASCADE'],
  ['submissions', 'reviewedBy', 'users', 'fk_submissions_reviewed_by', 'SET NULL'],
  ['coding_submissions', 'attempt', 'attempts', 'fk_coding_submissions_attempt', 'CASCADE'],
  ['coding_submissions', 'question', 'questions', 'fk_coding_submissions_question', 'CASCADE'],
].map(([tableName, columnName, referencedTableName, constraintName, onDelete]) => ({
  tableName,
  columnName,
  referencedTableName,
  referencedColumnName: 'id',
  constraintName,
  indexName: `${constraintName}_idx`,
  onDelete,
}));

async function foreignKeyExists(tableName, constraintName) {
  const [rows] = await sequelize.query(
    `SELECT CONSTRAINT_NAME
     FROM information_schema.TABLE_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA = ?
       AND TABLE_NAME = ?
       AND CONSTRAINT_NAME = ?
       AND CONSTRAINT_TYPE = 'FOREIGN KEY'
     LIMIT 1`,
    { replacements: [databaseConfig.database, tableName, constraintName] }
  );

  return rows.length > 0;
}

async function countForeignKeyOrphans(definition) {
  const childTable = escapeIdentifier(definition.tableName);
  const childColumn = escapeIdentifier(definition.columnName);
  const parentTable = escapeIdentifier(definition.referencedTableName);
  const parentColumn = escapeIdentifier(definition.referencedColumnName);

  const [rows] = await sequelize.query(
    `SELECT COUNT(*) AS orphanCount
     FROM ${childTable} child_table
     LEFT JOIN ${parentTable} parent_table
       ON child_table.${childColumn} = parent_table.${parentColumn}
     WHERE child_table.${childColumn} IS NOT NULL
       AND parent_table.${parentColumn} IS NULL`
  );

  return Number(rows[0]?.orphanCount || 0);
}

async function ensureForeignKey(definition) {
  if (await foreignKeyExists(definition.tableName, definition.constraintName)) return;

  const orphanCount = await countForeignKeyOrphans(definition);
  if (orphanCount > 0) {
    console.warn(
      `Skipped foreign key ${definition.constraintName}: ${orphanCount} existing ${definition.tableName}.${definition.columnName} value(s) do not reference ${definition.referencedTableName}.${definition.referencedColumnName}.`
    );
    return;
  }

  await ensureIndex(definition.tableName, definition.indexName, [definition.columnName]);

  await sequelize.getQueryInterface().addConstraint(definition.tableName, {
    fields: [definition.columnName],
    type: 'foreign key',
    name: definition.constraintName,
    references: {
      table: definition.referencedTableName,
      field: definition.referencedColumnName,
    },
    onDelete: definition.onDelete,
  });
}

async function ensureApplicationForeignKeys() {
  for (const definition of FOREIGN_KEY_DEFINITIONS) {
    try {
      await ensureForeignKey(definition);
    } catch (error) {
      console.warn(`Skipped foreign key ${definition.constraintName}: ${error.message}`);
    }
  }
}

async function teacherCodeExists(teacherCode) {
  const [rows] = await sequelize.query('SELECT `id` FROM `users` WHERE `teacherCode` = ? LIMIT 1', {
    replacements: [teacherCode],
  });
  return rows.length > 0;
}

async function nextUniqueTeacherCode() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const teacherCode = createTeacherCode();
    if (!(await teacherCodeExists(teacherCode))) return teacherCode;
  }

  return createTeacherCode(8);
}

async function backfillTeacherCodes() {
  const [teachers] = await sequelize.query(
    'SELECT `id` FROM `users` WHERE `role` = "teacher" AND (`teacherCode` IS NULL OR `teacherCode` = "")'
  );

  for (const teacher of teachers) {
    await sequelize.query('UPDATE `users` SET `teacherCode` = ? WHERE `id` = ?', {
      replacements: [await nextUniqueTeacherCode(), teacher.id],
    });
  }
}

async function ensureApplicationColumns() {
  const userProfileColumns = [
    ['teacherCode', { type: DataTypes.STRING(32), allowNull: true }],
    ['department', { type: DataTypes.STRING(150), allowNull: false, defaultValue: '' }],
    ['institution', { type: DataTypes.STRING(180), allowNull: false, defaultValue: '' }],
    ['designation', { type: DataTypes.STRING(120), allowNull: false, defaultValue: '' }],
    ['phone', { type: DataTypes.STRING(40), allowNull: false, defaultValue: '' }],
    ['studentId', { type: DataTypes.STRING(80), allowNull: false, defaultValue: '' }],
    ['section', { type: DataTypes.STRING(80), allowNull: false, defaultValue: '' }],
    ['batch', { type: DataTypes.STRING(80), allowNull: false, defaultValue: '' }],
    ['officeLocation', { type: DataTypes.STRING(150), allowNull: false, defaultValue: '' }],
    ['officeHours', { type: DataTypes.STRING(120), allowNull: false, defaultValue: '' }],
    ['expertise', { type: DataTypes.TEXT('long'), allowNull: true }],
    ['bio', { type: DataTypes.TEXT('long'), allowNull: true }],
  ];

  for (const [columnName, definition] of userProfileColumns) {
    await ensureColumn('users', columnName, definition);
  }

  await ensureColumn('quizzes', 'maxAttempts', {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 10,
  });
  await ensureColumn('attempts', 'attemptNumber', {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 1,
  });
  await ensureColumn('exam_roster_entries', 'studentName', {
    type: DataTypes.STRING(150),
    allowNull: true,
  });
  await ensureColumn('exam_roster_entries', 'student', {
    type: DataTypes.CHAR(24),
    allowNull: true,
  });
  await ensureColumn('exam_roster_entries', 'section', {
    type: DataTypes.STRING(80),
    allowNull: false,
    defaultValue: '',
  });

  await sequelize.query('UPDATE `quizzes` SET `maxAttempts` = 10 WHERE `maxAttempts` IS NULL OR `maxAttempts` < 1');
  await sequelize.query('UPDATE `attempts` SET `attemptNumber` = 1 WHERE `attemptNumber` IS NULL OR `attemptNumber` < 1');
  await sequelize.query('UPDATE `exam_roster_entries` SET `section` = "" WHERE `section` IS NULL');
  await sequelize.query('UPDATE `users` SET `department` = "" WHERE `department` IS NULL');
  await sequelize.query('UPDATE `users` SET `institution` = "" WHERE `institution` IS NULL');
  await sequelize.query('UPDATE `users` SET `designation` = "" WHERE `designation` IS NULL');
  await sequelize.query('UPDATE `users` SET `phone` = "" WHERE `phone` IS NULL');
  await sequelize.query('UPDATE `users` SET `studentId` = "" WHERE `studentId` IS NULL');
  await sequelize.query('UPDATE `users` SET `section` = "" WHERE `section` IS NULL');
  await sequelize.query('UPDATE `users` SET `batch` = "" WHERE `batch` IS NULL');
  await sequelize.query('UPDATE `users` SET `officeLocation` = "" WHERE `officeLocation` IS NULL');
  await sequelize.query('UPDATE `users` SET `officeHours` = "" WHERE `officeHours` IS NULL');
  await sequelize.query('UPDATE `users` SET `teacherCode` = NULL WHERE `teacherCode` = ""');
  await backfillTeacherCodes();
  await ensureIndex('users', 'users_teacher_code_unique', ['teacherCode'], { unique: true });
}

async function backfillAttemptNumbers() {
  const [rows] = await sequelize.query(
    'SELECT `id`, `student`, `quiz`, `submittedAt`, `createdAt`, `attemptNumber` FROM `attempts` ORDER BY `student`, `quiz`, `submittedAt`, `createdAt`, `id`'
  );
  const groups = new Map();

  rows.forEach((row) => {
    const key = `${row.student}:${row.quiz}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  });

  for (const attempts of groups.values()) {
    const needsUpdate = attempts.some((attempt, index) => Number(attempt.attemptNumber || 0) !== index + 1);
    if (!needsUpdate) continue;

    for (let index = 0; index < attempts.length; index += 1) {
      await sequelize.query('UPDATE `attempts` SET `attemptNumber` = ? WHERE `id` = ?', {
        replacements: [index + 1, attempts[index].id],
      });
    }
  }
}

async function ensureDatabaseExists() {
  const connection = await mysql.createConnection({
    host: databaseConfig.host,
    port: databaseConfig.port,
    user: databaseConfig.username,
    password: databaseConfig.password,
    multipleStatements: false,
  });

  try {
    await connection.query(
      `CREATE DATABASE IF NOT EXISTS ${escapeIdentifier(databaseConfig.database)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
  } finally {
    await connection.end();
  }
}

async function connectMySql() {
  await ensureDatabaseExists();
  await sequelize.authenticate();
  await sequelize.sync({ alter: process.env.DB_SYNC_ALTER === 'true' });
  await ensureApplicationColumns();
  await backfillAttemptNumbers();
  await ensureApplicationForeignKeys();
  console.log('MySQL connected');
}

function getSessionStoreOptions() {
  return {
    host: databaseConfig.host,
    port: databaseConfig.port,
    user: databaseConfig.username,
    password: databaseConfig.password,
    database: databaseConfig.database,
    expiration: getSessionMaxAgeMs(),
    createDatabaseTable: true,
    schema: {
      tableName: 'sessions',
      columnNames: {
        session_id: 'session_id',
        expires: 'expires',
        data: 'data',
      },
    },
  };
}

module.exports = {
  sequelize,
  connectMySql,
  getSessionStoreOptions,
  databaseConfig,
};
