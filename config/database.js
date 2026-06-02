const mysql = require('mysql2/promise');
const { Sequelize, DataTypes } = require('sequelize');

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

async function ensureApplicationColumns() {
  const userProfileColumns = [
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
