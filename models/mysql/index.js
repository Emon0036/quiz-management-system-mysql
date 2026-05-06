const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { DataTypes, Op } = require('sequelize');
const { sequelize } = require('../../config/database');

const adapters = {};

const ID_FIELDS = new Set([
  'id',
  '_id',
  'user',
  'student',
  'quiz',
  'question',
  'attempt',
  'problem',
  'createdBy',
  'approvedBy',
  'blockedBy',
  'reviewedBy',
  'bestAttemptId',
]);

const DATE_FIELDS = new Set([
  'approvedAt',
  'blockedAt',
  'resetPasswordExpires',
  'enrolledAt',
  'startedAt',
  'submittedAt',
  'reviewedAt',
  'executedAt',
  'lastAttemptDate',
  'lastUpdated',
  'createdAt',
  'updatedAt',
]);

const RELATIONS = {
  user: 'User',
  student: 'User',
  createdBy: 'User',
  approvedBy: 'User',
  blockedBy: 'User',
  reviewedBy: 'User',
  quiz: 'Quiz',
  question: 'Question',
  problem: 'Problem',
  attempt: 'Attempt',
  bestAttemptId: 'Attempt',
};

const NESTED_RELATIONS = {
  'answers.question': 'Question',
  'entries.student': 'User',
};

function generateId() {
  return crypto.randomBytes(12).toString('hex');
}

function jsonColumn() {
  return DataTypes.TEXT('long');
}

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date);
}

function isDocument(value) {
  return Boolean(value && value._adapter && value._id);
}

function idOf(value) {
  if (value === undefined || value === null || value === '') return value;
  if (isDocument(value)) return String(value._id);
  if (isPlainObject(value) && value._id) return String(value._id);
  if (isPlainObject(value) && value.id) return String(value.id);
  return String(value);
}

function normalizeDate(value) {
  if (value === undefined || value === null || value === '') return null;
  if (value instanceof Date) return value;
  return new Date(value);
}

function serializeValue(value) {
  if (isDocument(value)) return value.toObject();
  if (Array.isArray(value)) return value.map(serializeValue);
  if (value instanceof Date) return value;
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !key.startsWith('_adapter') && !key.startsWith('_original'))
        .map(([key, item]) => [key, serializeValue(item)])
    );
  }
  return value;
}

function sanitizeJsonValue(value) {
  if (isDocument(value)) return idOf(value);
  if (Array.isArray(value)) return value.map(sanitizeJsonValue);
  if (value instanceof Date) return value.toISOString();
  if (isPlainObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitizeJsonValue(item)]));
  }
  return value;
}

function parseJson(value, fallback) {
  if (value === undefined || value === null || value === '') return clone(fallback);
  if (typeof value !== 'string') return value;

  try {
    return JSON.parse(value);
  } catch {
    return clone(fallback);
  }
}

function looksHashedPassword(value) {
  return /^\$2[aby]\$/.test(String(value || ''));
}

function calculateGrade(percentage) {
  const value = Number(percentage || 0);
  if (value >= 90) return 'A';
  if (value >= 80) return 'B';
  if (value >= 70) return 'C';
  if (value >= 60) return 'D';
  return 'F';
}

function defineHidden(target, key, value) {
  Object.defineProperty(target, key, {
    value,
    enumerable: false,
    configurable: true,
    writable: true,
  });
}

class MySqlDocument {
  constructor(adapter, data) {
    defineHidden(this, '_adapter', adapter);
    defineHidden(this, '_original', {});
    this._replace(data);
  }

  _replace(data) {
    Object.assign(this, data);
    this._id = this._id || this.id;
    this.id = this._id;
    this._adapter.attachMethods(this);
    this._original = clone(this.toObject());
    return this;
  }

  async save(options) {
    return this._adapter.saveDocument(this, options);
  }

  toObject() {
    const output = {};
    Object.keys(this).forEach((key) => {
      output[key] = serializeValue(this[key]);
    });
    return output;
  }

  toJSON() {
    return this.toObject();
  }
}

class Query {
  constructor(adapter, mode, filter = {}) {
    this.adapter = adapter;
    this.mode = mode;
    this.filter = filter || {};
    this.populateSpecs = [];
    this.sortValue = null;
    this.limitValue = null;
    this.skipValue = null;
    this.selectValue = null;
  }

  populate(path, select) {
    this.populateSpecs.push(...normalizePopulateSpecs(path, select));
    return this;
  }

  sort(value) {
    this.sortValue = value;
    return this;
  }

  limit(value) {
    this.limitValue = Number(value);
    return this;
  }

  skip(value) {
    this.skipValue = Number(value);
    return this;
  }

  select(value) {
    this.selectValue = value;
    return this;
  }

  async exec() {
    const result = await this.adapter.findDocuments(this.filter, {
      single: this.mode === 'findOne',
      sort: this.sortValue,
      limit: this.limitValue,
      skip: this.skipValue,
      select: this.selectValue,
    });

    for (const spec of this.populateSpecs) {
      await this.adapter.populateDocuments(result, spec);
    }

    return result;
  }

  then(resolve, reject) {
    return this.exec().then(resolve, reject);
  }

  catch(reject) {
    return this.exec().catch(reject);
  }

  finally(callback) {
    return this.exec().finally(callback);
  }
}

function normalizePopulateSpecs(path, select) {
  if (!path) return [];
  if (Array.isArray(path)) return path.flatMap((item) => normalizePopulateSpecs(item));
  if (typeof path === 'string') return [{ path, select }];
  return [{ ...path }];
}

function parseSort(sort) {
  if (!sort) return [];
  if (typeof sort === 'string') {
    return sort
      .split(/\s+/)
      .filter(Boolean)
      .map((field) => (field.startsWith('-') ? [field.slice(1), 'DESC'] : [field, 'ASC']));
  }

  if (Array.isArray(sort)) return sort;

  return Object.entries(sort).map(([field, direction]) => [
    field,
    Number(direction) < 0 || String(direction).toLowerCase() === 'desc' ? 'DESC' : 'ASC',
  ]);
}

function fieldName(field) {
  return field === '_id' ? 'id' : field;
}

function filterValue(field, value) {
  if (DATE_FIELDS.has(field) && typeof value === 'number') return new Date(value);
  if (ID_FIELDS.has(field)) return idOf(value);
  return isDocument(value) ? idOf(value) : value;
}

function filterToWhere(filter = {}) {
  const where = {};

  Object.entries(filter || {}).forEach(([rawField, value]) => {
    if (rawField === '$or') {
      where[Op.or] = (Array.isArray(value) ? value : []).map((item) => filterToWhere(item));
      return;
    }

    const field = fieldName(rawField);
    if (isPlainObject(value) && !isDocument(value)) {
      const operatorWhere = {};
      Object.entries(value).forEach(([operator, operatorValue]) => {
        if (operator === '$in') operatorWhere[Op.in] = (operatorValue || []).map((item) => filterValue(field, item));
        else if (operator === '$ne') operatorWhere[Op.ne] = filterValue(field, operatorValue);
        else if (operator === '$gt') operatorWhere[Op.gt] = filterValue(field, operatorValue);
        else if (operator === '$gte') operatorWhere[Op.gte] = filterValue(field, operatorValue);
        else if (operator === '$lt') operatorWhere[Op.lt] = filterValue(field, operatorValue);
        else if (operator === '$lte') operatorWhere[Op.lte] = filterValue(field, operatorValue);
        else if (operator === '$eq') operatorWhere[Op.eq] = filterValue(field, operatorValue);
      });
      where[field] = operatorWhere;
      return;
    }

    where[field] = filterValue(field, value);
  });

  return where;
}

function equalityFieldsFromFilter(filter = {}) {
  const output = {};
  Object.entries(filter || {}).forEach(([field, value]) => {
    if (field.startsWith('$')) return;
    if (isPlainObject(value) && !isDocument(value)) return;
    output[field === '_id' ? '_id' : field] = value;
  });
  return output;
}

function applyUpdateToDocument(doc, update = {}, includeInsertOnly = false) {
  Object.entries(update || {}).forEach(([key, value]) => {
    if (key === '$set') {
      Object.assign(doc, value);
    } else if (key === '$inc') {
      Object.entries(value || {}).forEach(([field, amount]) => {
        doc[field] = Number(doc[field] || 0) + Number(amount || 0);
      });
    } else if (key === '$setOnInsert') {
      if (includeInsertOnly) Object.assign(doc, value);
    } else if (!key.startsWith('$')) {
      doc[key] = value;
    }
  });
}

class ModelAdapter {
  constructor(name, model, options = {}) {
    this.name = name;
    this.model = model;
    this.jsonFields = options.jsonFields || {};
    this.scalarDefaults = options.scalarDefaults || {};
    this.sanitizeJson = options.sanitizeJson || {};
    this.beforeSave = options.beforeSave || null;
  }

  attachMethods(doc) {
    if (this.name === 'User') {
      defineHidden(doc, 'matchPassword', function matchPassword(password) {
        return bcrypt.compare(password, this.password || '');
      });

      defineHidden(doc, 'createPasswordResetToken', function createPasswordResetToken() {
        const token = crypto.randomBytes(32).toString('hex');
        this.resetPasswordToken = crypto.createHash('sha256').update(token).digest('hex');
        this.resetPasswordExpires = new Date(Date.now() + 60 * 60 * 1000);
        return token;
      });
    }

    if (this.name === 'Question') {
      defineHidden(doc, 'checkAnswer', function checkAnswer(answer) {
        if (this.type === 'short-answer') return false;
        return String(answer || '').trim().toLowerCase() === String(this.correctAnswer || '').trim().toLowerCase();
      });
    }

    if (this.name === 'Leaderboard') {
      defineHidden(doc, 'recordAttempt', async function recordAttempt(studentId, score, percentage) {
        const normalizedStudentId = idOf(studentId);
        this.entries = Array.isArray(this.entries) ? this.entries : [];
        let entry = this.entries.find((item) => idOf(item.student) === normalizedStudentId);

        if (!entry) {
          entry = {
            student: normalizedStudentId,
            bestScore: score,
            bestPercentage: percentage,
            attemptCount: 0,
            rank: 0,
            lastAttemptAt: new Date().toISOString(),
          };
          this.entries.push(entry);
        }

        entry.attemptCount = Number(entry.attemptCount || 0) + 1;
        entry.lastAttemptAt = new Date().toISOString();
        if (Number(percentage || 0) > Number(entry.bestPercentage || 0)) {
          entry.bestScore = score;
          entry.bestPercentage = percentage;
        }

        this.entries.sort(
          (left, right) =>
            Number(right.bestPercentage || 0) - Number(left.bestPercentage || 0) ||
            Number(right.bestScore || 0) - Number(left.bestScore || 0)
        );
        this.entries.forEach((item, index) => {
          item.rank = index + 1;
        });

        await this.save();
      });
    }
  }

  rowToData(row) {
    if (!row) return null;
    const plain = typeof row.get === 'function' ? row.get({ plain: true }) : row;
    const output = {};

    Object.keys(this.model.rawAttributes).forEach((field) => {
      let value = plain[field];

      if (field === 'id') {
        output.id = value;
        output._id = value;
        return;
      }

      if (this.jsonFields[field]) {
        value = parseJson(value, this.jsonFields[field]);
      } else if ((value === null || value === undefined) && Object.prototype.hasOwnProperty.call(this.scalarDefaults, field)) {
        value = clone(this.scalarDefaults[field]);
      }

      output[field] = value;
    });

    return output;
  }

  makeDocument(row) {
    const data = this.rowToData(row);
    return data ? new MySqlDocument(this, data) : null;
  }

  jsonFieldValue(field, value) {
    const fallback = this.jsonFields[field];
    const sanitizer = this.sanitizeJson[field];
    const normalized = value === undefined ? clone(fallback) : value;
    const sanitized = sanitizer ? sanitizer(normalized) : sanitizeJsonValue(normalized);
    return JSON.stringify(sanitized ?? fallback ?? null);
  }

  toRow(doc, { forCreate = false } = {}) {
    const row = {};

    Object.keys(this.model.rawAttributes).forEach((field) => {
      if (field === 'createdAt' || field === 'updatedAt') return;

      if (field === 'id') {
        row.id = idOf(doc._id || doc.id) || generateId();
        return;
      }

      const hasValue = Object.prototype.hasOwnProperty.call(doc, field);
      if (!hasValue && !forCreate) return;
      if (
        !hasValue &&
        forCreate &&
        !this.jsonFields[field] &&
        !Object.prototype.hasOwnProperty.call(this.scalarDefaults, field)
      ) {
        return;
      }

      let value = hasValue ? doc[field] : undefined;
      if (this.jsonFields[field]) {
        row[field] = this.jsonFieldValue(field, value);
      } else if (DATE_FIELDS.has(field)) {
        row[field] = value === undefined ? null : normalizeDate(value);
      } else if (ID_FIELDS.has(field)) {
        row[field] = value === undefined ? null : idOf(value);
      } else if (value === undefined && Object.prototype.hasOwnProperty.call(this.scalarDefaults, field)) {
        row[field] = this.scalarDefaults[field];
      } else {
        row[field] = value === undefined ? null : value;
      }
    });

    return row;
  }

  async prepareForSave(doc, isNew) {
    if (this.name === 'User') {
      if (doc.email) doc.email = String(doc.email).toLowerCase().trim();
      if (doc.name) doc.name = String(doc.name).trim();
    }

    if (this.name === 'User' && doc.password) {
      const originalPassword = doc._original ? doc._original.password : null;
      if ((isNew || doc.password !== originalPassword) && !looksHashedPassword(doc.password)) {
        doc.password = await bcrypt.hash(doc.password, 12);
      }
    }

    if (this.name === 'Result') {
      doc.grade = calculateGrade(doc.percentage);
    }

    if (typeof this.beforeSave === 'function') {
      await this.beforeSave(doc, isNew);
    }
  }

  find(filter = {}) {
    return new Query(this, 'find', filter);
  }

  findOne(filter = {}) {
    return new Query(this, 'findOne', filter);
  }

  findById(id) {
    return this.findOne({ _id: id });
  }

  async findDocuments(filter = {}, options = {}) {
    const queryOptions = {
      where: filterToWhere(filter),
      order: parseSort(options.sort),
    };

    if (Number.isFinite(options.limit)) queryOptions.limit = options.limit;
    if (Number.isFinite(options.skip)) queryOptions.offset = options.skip;

    if (options.single) {
      const row = await this.model.findOne(queryOptions);
      return this.makeDocument(row);
    }

    const rows = await this.model.findAll(queryOptions);
    return rows.map((row) => this.makeDocument(row)).filter(Boolean);
  }

  async findOneDocument(filter = {}) {
    return this.findDocuments(filter, { single: true });
  }

  async create(payload) {
    if (Array.isArray(payload)) return Promise.all(payload.map((item) => this.create(item)));

    const id = payload?._id || payload?.id || generateId();
    const doc = new MySqlDocument(this, {
      ...payload,
      _id: id,
      id,
    });
    doc._id = doc._id || doc.id;
    doc.id = doc._id;
    await this.prepareForSave(doc, true);

    const row = this.toRow(doc, { forCreate: true });
    await this.model.create(row);
    return this.findOneDocument({ _id: row.id });
  }

  async saveDocument(doc) {
    const id = idOf(doc._id || doc.id) || generateId();
    doc._id = id;
    doc.id = id;

    const existing = await this.model.findByPk(id);
    await this.prepareForSave(doc, !existing);
    const row = this.toRow(doc, { forCreate: !existing });

    if (existing) await this.model.update(row, { where: { id } });
    else await this.model.create(row);

    const fresh = await this.model.findByPk(id);
    doc._replace(this.rowToData(fresh));
    return doc;
  }

  async countDocuments(filter = {}) {
    return this.model.count({ where: filterToWhere(filter) });
  }

  async deleteMany(filter = {}) {
    const deletedCount = await this.model.destroy({ where: filterToWhere(filter) });
    return { acknowledged: true, deletedCount };
  }

  async deleteOne(filter = {}) {
    const doc = await this.findOneDocument(filter);
    const deletedCount = doc ? await this.model.destroy({ where: { id: doc._id } }) : 0;
    return { acknowledged: true, deletedCount };
  }

  async findOneAndDelete(filter = {}) {
    const doc = await this.findOneDocument(filter);
    if (!doc) return null;
    await this.deleteOne({ _id: doc._id });
    return doc;
  }

  async findByIdAndUpdate(id, update = {}, options = {}) {
    return this.findOneAndUpdate({ _id: id }, update, options);
  }

  async findOneAndUpdate(filter = {}, update = {}, options = {}) {
    let doc = await this.findOneDocument(filter);

    if (!doc && options.upsert) {
      doc = new MySqlDocument(this, {
        ...equalityFieldsFromFilter(filter),
        _id: equalityFieldsFromFilter(filter)._id || generateId(),
      });
      applyUpdateToDocument(doc, update, true);
      await doc.save();
      return doc;
    }

    if (!doc) return null;

    applyUpdateToDocument(doc, update, false);
    await doc.save();
    return doc;
  }

  async distinct(field, filter = {}) {
    const docs = await this.find(filter);
    const values = docs.map((doc) => doc[field]).filter((value) => value !== undefined && value !== null);
    return Array.from(new Set(values.map((value) => String(value))));
  }

  async aggregate(pipeline = []) {
    const matchStage = pipeline.find((stage) => stage.$match);
    const groupStage = pipeline.find((stage) => stage.$group);
    const docs = await this.find(matchStage ? matchStage.$match : {});

    if (!groupStage) return docs;

    const groupDefinition = groupStage.$group;
    const groupField = String(groupDefinition._id || '').replace(/^\$/, '');
    const grouped = new Map();

    docs.forEach((doc) => {
      const key = String(doc[groupField]);
      if (!grouped.has(key)) grouped.set(key, { _id: doc[groupField] });
      const target = grouped.get(key);

      Object.entries(groupDefinition).forEach(([field, expression]) => {
        if (field === '_id') return;
        target[field] = target[field] || 0;

        if (isPlainObject(expression) && expression.$sum === 1) {
          target[field] += 1;
        } else if (isPlainObject(expression) && isPlainObject(expression.$sum) && Array.isArray(expression.$sum.$cond)) {
          const [condition, passValue, failValue] = expression.$sum.$cond;
          let passed = false;
          if (isPlainObject(condition) && Array.isArray(condition.$eq)) {
            const [left, right] = condition.$eq;
            const docField = String(left || '').replace(/^\$/, '');
            passed = doc[docField] === right;
          }
          target[field] += passed ? Number(passValue || 0) : Number(failValue || 0);
        }
      });
    });

    return Array.from(grouped.values());
  }

  async populateDocuments(target, spec) {
    if (!target) return target;
    const docs = Array.isArray(target) ? target : [target];
    for (const doc of docs) {
      await this.populateDocument(doc, spec);
    }
    return target;
  }

  async populateDocument(doc, spec) {
    if (!doc || !spec?.path) return doc;

    if (spec.path.includes('.')) {
      return populateNestedDocument(doc, spec);
    }

    if (spec.path === 'questions') {
      const ids = Array.isArray(doc.questions) ? doc.questions.map(idOf).filter(Boolean) : [];
      let questions = [];
      if (ids.length) {
        questions = await adapters.Question.find({ _id: { $in: ids } });
        const order = new Map(ids.map((id, index) => [String(id), index]));
        questions.sort((left, right) => (order.get(String(left._id)) ?? 0) - (order.get(String(right._id)) ?? 0));
      } else if (doc._id) {
        questions = await adapters.Question.find({ quiz: doc._id }).sort('createdAt');
      }
      doc.questions = questions;
      return doc;
    }

    const targetModelName = RELATIONS[spec.path];
    if (!targetModelName) return doc;

    const rawId = doc[spec.path];
    if (!rawId) {
      doc[spec.path] = null;
      return doc;
    }

    const filter = { _id: idOf(rawId), ...(spec.match || {}) };
    const populated = await adapters[targetModelName].findOneDocument(filter);
    doc[spec.path] = populated;

    if (populated && spec.populate) {
      for (const childSpec of normalizePopulateSpecs(spec.populate)) {
        await adapters[targetModelName].populateDocument(populated, childSpec);
      }
    }

    return doc;
  }
}

async function populateNestedDocument(doc, spec) {
  const targetModelName = NESTED_RELATIONS[spec.path];
  if (!targetModelName) return doc;

  const [collectionField, referenceField] = spec.path.split('.');
  const collection = Array.isArray(doc[collectionField]) ? doc[collectionField] : [];

  for (const item of collection) {
    const rawId = item?.[referenceField];
    if (!rawId) {
      item[referenceField] = null;
      continue;
    }

    const populated = await adapters[targetModelName].findOneDocument({
      _id: idOf(rawId),
      ...(spec.match || {}),
    });
    item[referenceField] = populated;

    if (populated && spec.populate) {
      for (const childSpec of normalizePopulateSpecs(spec.populate)) {
        await adapters[targetModelName].populateDocument(populated, childSpec);
      }
    }
  }

  return doc;
}

function defineModel(name, tableName, attributes, options = {}) {
  const model = sequelize.define(
    name,
    {
      id: {
        type: DataTypes.CHAR(24),
        allowNull: false,
        primaryKey: true,
      },
      ...attributes,
    },
    {
      tableName,
      timestamps: true,
      indexes: options.indexes || [],
    }
  );

  adapters[name] = new ModelAdapter(name, model, options);
}

defineModel(
  'User',
  'users',
  {
    name: { type: DataTypes.STRING(100), allowNull: false },
    email: { type: DataTypes.STRING(255), allowNull: false, unique: true },
    password: { type: DataTypes.STRING(255), allowNull: true },
    role: { type: DataTypes.ENUM('admin', 'teacher', 'student'), allowNull: false, defaultValue: 'student' },
    teacherStatus: {
      type: DataTypes.ENUM('none', 'pending', 'approved', 'rejected'),
      allowNull: false,
      defaultValue: 'none',
    },
    accountStatus: { type: DataTypes.ENUM('active', 'blocked'), allowNull: false, defaultValue: 'active' },
    approvedBy: { type: DataTypes.CHAR(24), allowNull: true },
    approvedAt: { type: DataTypes.DATE, allowNull: true },
    blockedBy: { type: DataTypes.CHAR(24), allowNull: true },
    blockedAt: { type: DataTypes.DATE, allowNull: true },
    profileImage: { type: DataTypes.STRING(500), allowNull: false, defaultValue: '/images/default-avatar.png' },
    resetPasswordToken: { type: DataTypes.STRING(255), allowNull: true },
    resetPasswordExpires: { type: DataTypes.DATE, allowNull: true },
  },
  {
    indexes: [{ unique: true, fields: ['email'] }],
    scalarDefaults: {
      teacherStatus: 'none',
      accountStatus: 'active',
      profileImage: '/images/default-avatar.png',
    },
  }
);

defineModel(
  'Admin',
  'admins',
  {
    user: { type: DataTypes.CHAR(24), allowNull: false, unique: true },
    createdBy: { type: DataTypes.CHAR(24), allowNull: true },
    permissions: { type: jsonColumn(), allowNull: true },
  },
  {
    indexes: [{ unique: true, fields: ['user'] }],
    jsonFields: {
      permissions: { manageUsers: true, manageTeachers: true, manageAdmins: true },
    },
  }
);

defineModel(
  'Quiz',
  'quizzes',
  {
    title: { type: DataTypes.STRING(200), allowNull: false },
    description: { type: DataTypes.TEXT('long'), allowNull: true },
    category: { type: DataTypes.STRING(255), allowNull: false, defaultValue: 'General Knowledge' },
    thumbnailUrl: { type: DataTypes.STRING(1000), allowNull: false, defaultValue: '' },
    thumbnailPublicId: { type: DataTypes.STRING(500), allowNull: false, defaultValue: '' },
    examType: {
      type: DataTypes.ENUM('quiz', 'true-false', 'short-answer', 'coding-test'),
      allowNull: false,
      defaultValue: 'quiz',
    },
    difficulty: { type: DataTypes.ENUM('Easy', 'Medium', 'Hard'), allowNull: false, defaultValue: 'Medium' },
    duration: { type: DataTypes.INTEGER, allowNull: false },
    passingMarks: { type: DataTypes.FLOAT, allowNull: false },
    totalMarks: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },
    createdBy: { type: DataTypes.CHAR(24), allowNull: false },
    questions: { type: jsonColumn(), allowNull: true },
    status: { type: DataTypes.ENUM('draft', 'published'), allowNull: false, defaultValue: 'draft' },
  },
  {
    indexes: [
      { fields: ['status', 'category', 'difficulty'] },
      { fields: ['status', 'examType', 'category'] },
      { fields: ['createdBy', 'createdAt'] },
    ],
    jsonFields: { questions: [] },
    scalarDefaults: {
      description: '',
      category: 'General Knowledge',
      thumbnailUrl: '',
      thumbnailPublicId: '',
      examType: 'quiz',
      difficulty: 'Medium',
      totalMarks: 0,
      status: 'draft',
    },
    sanitizeJson: {
      questions: (value) => (Array.isArray(value) ? value.map(idOf).filter(Boolean) : []),
    },
  }
);

defineModel(
  'Question',
  'questions',
  {
    quiz: { type: DataTypes.CHAR(24), allowNull: false },
    questionText: { type: DataTypes.TEXT('long'), allowNull: false },
    type: { type: DataTypes.ENUM('multiple-choice', 'true-false', 'short-answer', 'coding'), allowNull: false },
    options: { type: jsonColumn(), allowNull: true },
    correctAnswer: { type: DataTypes.TEXT('long'), allowNull: true },
    explanation: { type: DataTypes.TEXT('long'), allowNull: true },
    marks: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 1 },
    codeTemplate: { type: DataTypes.TEXT('long'), allowNull: true },
    language: { type: DataTypes.STRING(100), allowNull: true },
    testCases: { type: jsonColumn(), allowNull: true },
  },
  {
    indexes: [{ fields: ['quiz'] }],
    jsonFields: { options: [], testCases: [] },
    scalarDefaults: { correctAnswer: '', explanation: '', marks: 1, codeTemplate: '', language: '' },
  }
);

defineModel(
  'Attempt',
  'attempts',
  {
    student: { type: DataTypes.CHAR(24), allowNull: false },
    quiz: { type: DataTypes.CHAR(24), allowNull: false },
    answers: { type: jsonColumn(), allowNull: true },
    score: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },
    totalMarks: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },
    percentage: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },
    status: { type: DataTypes.ENUM('submitted', 'pending-review', 'reviewed'), allowNull: false, defaultValue: 'submitted' },
    passed: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    autoSubmitted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    autoSubmitReason: { type: DataTypes.STRING(255), allowNull: false, defaultValue: '' },
    startedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    submittedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    timeSpent: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    progressUpdated: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    pointsAwarded: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },
  },
  {
    indexes: [
      { fields: ['student', 'quiz', 'submittedAt'] },
      { fields: ['quiz', 'percentage', 'timeSpent'] },
      { fields: ['progressUpdated'] },
    ],
    jsonFields: { answers: [] },
    scalarDefaults: {
      score: 0,
      totalMarks: 0,
      percentage: 0,
      status: 'submitted',
      passed: false,
      autoSubmitted: false,
      autoSubmitReason: '',
      timeSpent: 0,
      progressUpdated: false,
      pointsAwarded: 0,
    },
    sanitizeJson: {
      answers: (value) =>
        (Array.isArray(value) ? value : []).map((answer) => ({
          ...answer,
          question: idOf(answer.question),
        })),
    },
  }
);

defineModel(
  'Result',
  'results',
  {
    student: { type: DataTypes.CHAR(24), allowNull: false },
    quiz: { type: DataTypes.CHAR(24), allowNull: false },
    attempt: { type: DataTypes.CHAR(24), allowNull: false },
    marksObtained: { type: DataTypes.FLOAT, allowNull: false },
    totalMarks: { type: DataTypes.FLOAT, allowNull: false },
    percentage: { type: DataTypes.FLOAT, allowNull: false },
    status: { type: DataTypes.ENUM('pass', 'fail', 'pending-review'), allowNull: false },
    grade: { type: DataTypes.STRING(2), allowNull: false, defaultValue: 'F' },
  },
  {
    indexes: [{ fields: ['student', 'quiz'] }, { fields: ['attempt'] }],
    scalarDefaults: { grade: 'F' },
  }
);

defineModel(
  'Enrollment',
  'enrollments',
  {
    student: { type: DataTypes.CHAR(24), allowNull: false },
    quiz: { type: DataTypes.CHAR(24), allowNull: false },
    enrolledAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    status: {
      type: DataTypes.ENUM('enrolled', 'pending-review', 'completed', 'expired'),
      allowNull: false,
      defaultValue: 'enrolled',
    },
    attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    bestScore: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },
    bestAttemptId: { type: DataTypes.CHAR(24), allowNull: true },
  },
  {
    indexes: [
      { unique: true, fields: ['student', 'quiz'] },
      { fields: ['student', 'status'] },
      { fields: ['quiz', 'status'] },
    ],
    scalarDefaults: { status: 'enrolled', attempts: 0, bestScore: 0 },
  }
);

defineModel(
  'Progress',
  'progress',
  {
    student: { type: DataTypes.CHAR(24), allowNull: false },
    totalQuizzes: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    completedQuizzes: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    inProgressQuizzes: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    averageScore: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },
    totalPoints: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },
    totalAttempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    passedQuizzes: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    failedQuizzes: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    streak: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    lastAttemptDate: { type: DataTypes.DATE, allowNull: true },
    badges: { type: jsonColumn(), allowNull: true },
    quizzesByCategory: { type: jsonColumn(), allowNull: true },
  },
  {
    indexes: [{ fields: ['student'] }, { fields: ['totalPoints', 'averageScore'] }],
    jsonFields: { badges: [], quizzesByCategory: [] },
    scalarDefaults: {
      totalQuizzes: 0,
      completedQuizzes: 0,
      inProgressQuizzes: 0,
      averageScore: 0,
      totalPoints: 0,
      totalAttempts: 0,
      passedQuizzes: 0,
      failedQuizzes: 0,
      streak: 0,
    },
  }
);

defineModel(
  'GlobalLeaderboard',
  'global_leaderboards',
  {
    student: { type: DataTypes.CHAR(24), allowNull: false, unique: true },
    totalPoints: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },
    averageScore: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },
    quizzesCompleted: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    rank: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    badge: { type: DataTypes.ENUM('gold', 'silver', 'bronze', 'none'), allowNull: false, defaultValue: 'none' },
    goldPoints: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },
    silverPoints: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },
    bronzePoints: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },
    streak: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    lastUpdated: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  },
  {
    indexes: [
      { fields: ['totalPoints', 'averageScore'] },
      { fields: ['rank'] },
      { fields: ['badge'] },
      { unique: true, fields: ['student'] },
    ],
    scalarDefaults: {
      totalPoints: 0,
      averageScore: 0,
      quizzesCompleted: 0,
      rank: 0,
      badge: 'none',
      goldPoints: 0,
      silverPoints: 0,
      bronzePoints: 0,
      streak: 0,
    },
  }
);

defineModel(
  'Leaderboard',
  'leaderboards',
  {
    quiz: { type: DataTypes.CHAR(24), allowNull: false, unique: true },
    entries: { type: jsonColumn(), allowNull: true },
  },
  {
    indexes: [{ unique: true, fields: ['quiz'] }],
    jsonFields: { entries: [] },
    sanitizeJson: {
      entries: (value) =>
        (Array.isArray(value) ? value : []).map((entry) => ({
          ...entry,
          student: idOf(entry.student),
        })),
    },
  }
);

defineModel(
  'Problem',
  'problems',
  {
    title: { type: DataTypes.STRING(255), allowNull: false },
    description: { type: DataTypes.TEXT('long'), allowNull: false },
    inputFormat: { type: DataTypes.TEXT('long'), allowNull: true },
    outputFormat: { type: DataTypes.TEXT('long'), allowNull: true },
    sampleInput: { type: DataTypes.TEXT('long'), allowNull: true },
    sampleOutput: { type: DataTypes.TEXT('long'), allowNull: true },
    testCases: { type: jsonColumn(), allowNull: true },
    difficulty: { type: DataTypes.ENUM('Easy', 'Medium', 'Hard'), allowNull: false, defaultValue: 'Medium' },
    createdBy: { type: DataTypes.CHAR(24), allowNull: true },
  },
  {
    indexes: [{ fields: ['createdBy'] }],
    jsonFields: { testCases: [] },
    scalarDefaults: {
      inputFormat: '',
      outputFormat: '',
      sampleInput: '',
      sampleOutput: '',
      difficulty: 'Medium',
    },
  }
);

defineModel(
  'Submission',
  'submissions',
  {
    problem: { type: DataTypes.CHAR(24), allowNull: false },
    student: { type: DataTypes.CHAR(24), allowNull: false },
    code: { type: DataTypes.TEXT('long'), allowNull: false },
    language: { type: DataTypes.ENUM('c', 'cpp', 'java', 'javascript', 'python'), allowNull: false },
    status: { type: DataTypes.ENUM('pending-review', 'reviewed'), allowNull: false, defaultValue: 'pending-review' },
    marksAwarded: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },
    teacherComment: { type: DataTypes.TEXT('long'), allowNull: true },
    correctedCode: { type: DataTypes.TEXT('long'), allowNull: true },
    reviewedBy: { type: DataTypes.CHAR(24), allowNull: true },
    reviewedAt: { type: DataTypes.DATE, allowNull: true },
    submittedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  },
  {
    indexes: [
      { fields: ['status'] },
      { fields: ['student', 'submittedAt'] },
      { fields: ['problem', 'submittedAt'] },
    ],
    scalarDefaults: {
      status: 'pending-review',
      marksAwarded: 0,
      teacherComment: '',
      correctedCode: '',
    },
  }
);

defineModel(
  'CodingSubmission',
  'coding_submissions',
  {
    attempt: { type: DataTypes.CHAR(24), allowNull: false },
    question: { type: DataTypes.CHAR(24), allowNull: false },
    studentCode: { type: DataTypes.TEXT('long'), allowNull: false },
    language: { type: DataTypes.ENUM('javascript', 'python', 'java', 'cpp', 'csharp'), allowNull: false },
    executionOutput: { type: DataTypes.TEXT('long'), allowNull: true },
    executionErrors: { type: DataTypes.TEXT('long'), allowNull: true },
    testsPassed: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    totalTests: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    isCorrect: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    marksObtained: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },
    executedAt: { type: DataTypes.DATE, allowNull: true },
    submittedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  },
  {
    indexes: [
      { fields: ['attempt', 'question'] },
      { fields: ['question', 'isCorrect'] },
    ],
    scalarDefaults: {
      executionOutput: '',
      executionErrors: '',
      testsPassed: 0,
      totalTests: 0,
      isCorrect: false,
      marksObtained: 0,
    },
  }
);

module.exports = adapters;
