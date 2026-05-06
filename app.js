require('dotenv').config();

const path = require('path');
const express = require('express');
const session = require('express-session');
const MySQLStoreFactory = require('express-mysql-session');
const passport = require('passport');
const methodOverride = require('method-override');
const engine = require('ejs-mate');
const { connectMySql, getSessionStoreOptions, sequelize } = require('./config/database');
const problemRoutes = require("./routes/problemRoutes");
const submissionRoutes = require("./routes/submissionRoutes");
const enrollmentRoutes = require("./routes/enrollmentRoutes");

const authRoutes = require('./routes/authRoutes');
const publicRoutes = require('./routes/publicRoutes');
const teacherRoutes = require('./routes/teacherRoutes');
const studentRoutes = require('./routes/studentRoutes');
const adminRoutes = require('./routes/adminRoutes');
const { notFound, errorHandler } = require('./middleware/errorMiddleware');
const { enforceActiveAccount } = require('./middleware/authMiddleware');
const { attachTabUser, resolveTabUser, preserveTabInRedirects } = require('./middleware/tabSessionMiddleware');
const flashMiddleware = require('./middleware/flashMiddleware');

const app = express();
const MySQLStore = MySQLStoreFactory(session);
let sessionStore = null;

function validateRuntimeConfig() {
  if (process.env.NODE_ENV !== 'production') return;

  if (!process.env.DB_NAME || !process.env.DB_USER) {
    throw new Error('DB_NAME and DB_USER are required in production.');
  }
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.includes('change') || process.env.SESSION_SECRET.includes('replace')) {
    throw new Error('Set a strong SESSION_SECRET before running in production.');
  }
}

function configureApp() {
  require('./config/passport')(passport);

  app.engine('ejs', engine);
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));

  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());
  app.use(methodOverride('_method'));
  app.use(express.static(path.join(__dirname, 'public')));
  app.get('/favicon.ico', (req, res) => res.status(204).end());
  app.get('/.well-known/appspecific/com.chrome.devtools.json', (req, res) => res.status(204).end());
  app.get('/images/default-avatar.png', (req, res) => {
    res
      .type('image/svg+xml')
      .set('Cache-Control', 'public, max-age=86400')
      .send(`
        <svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128" role="img" aria-label="Default avatar">
          <rect width="128" height="128" rx="64" fill="#dceff7"/>
          <circle cx="64" cy="49" r="24" fill="#0e5c8b"/>
          <path d="M25 112c6-24 21-38 39-38s33 14 39 38" fill="#1c9b8f"/>
        </svg>
      `);
  });

  // Sessions are stored in MySQL so logins survive server restarts.
  sessionStore = new MySQLStore(getSessionStoreOptions());
  app.use(
    session({
      secret: process.env.SESSION_SECRET || 'replace-this-secret',
      resave: false,
      saveUninitialized: false,
      store: sessionStore,
      cookie: {
        httpOnly: true,
        maxAge: 1000 * 60 * 60 * 24 * 7,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
      },
    })
  );

  app.use(attachTabUser);
  app.use(flashMiddleware);
  app.use(passport.initialize());
  app.use(passport.session());
  app.use(resolveTabUser);
  app.use(preserveTabInRedirects);
  app.use(enforceActiveAccount);

  // Make auth state and flash messages available to every EJS view.
  app.use((req, res, next) => {
    res.locals.currentUser = req.user || null;
    res.locals.currentTabId = req.currentTabId || null;
    res.locals.success = req.flash('success');
    res.locals.error = req.flash('error');
    res.locals.appName = 'QuizMaster';
    res.locals.pageClass = '';
    res.locals.hideSiteChrome = false;
    next();
  });

  app.use('/', publicRoutes);
  app.use('/auth', authRoutes);
  app.use('/admin', adminRoutes);
  app.use('/teacher', teacherRoutes);
  app.use('/student', studentRoutes);
  app.use('/enrollments', enrollmentRoutes);
  app.use('/problems', problemRoutes);
  app.use('/submissions', submissionRoutes);

  app.use(notFound);
  app.use(errorHandler);
}

async function start() {
  validateRuntimeConfig();
  await connectMySql();
  configureApp();

  const port = process.env.PORT || 3000;
  const server = app.listen(port, () => console.log(`Server running on http://localhost:${port}`));

  const shutdown = async () => {
    server.close(async () => {
      if (sessionStore && typeof sessionStore.close === 'function') {
        sessionStore.close();
      }
      await sequelize.close();
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

start().catch((error) => {
  console.error('Server startup failed:', error.message);
  process.exit(1);
});
