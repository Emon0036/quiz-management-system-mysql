
# Online Quiz Management System

A Node.js, Express, EJS, and MySQL based online quiz management system with admin, teacher, and student features.

## Requirements

Before running this project on another device, install:

- **Git** for cloning the repository
- **Node.js and npm** for running the application
- **MySQL** locally, or a hosted MySQL database connection

Check that Node.js and npm are installed:

```bash
node -v
npm -v
```

## Clone The Project

```bash
git clone <your-repository-url>
cd "Online quiz management system"
```

Replace `<your-repository-url>` with your GitHub repository URL.

## Install Dependencies

Install all project packages from `package.json`:

```bash
npm install
```

Main dependencies used in this project include:

- `express`
- `sequelize`
- `mysql2`
- `ejs`
- `ejs-mate`
- `passport`
- `passport-local`
- `bcryptjs`
- `express-session`
- `express-mysql-session`
- `dotenv`
- `method-override`
- `validator`

Development dependency:

- `nodemon`

## Environment Setup

Create a `.env` file from the example file:

```bash
copy .env.example .env
```

On macOS or Linux:

```bash
cp .env.example .env
```

Then update the values inside `.env` if needed:

```env
DB_HOST=127.0.0.1
DB_PORT=3306
DB_NAME=quiz_management_system
DB_USER=root
DB_PASSWORD=your_mysql_password
SESSION_SECRET=your_session_secret_key_here_change_in_production

PORT=3000
NODE_ENV=development
```

## Database Setup

If you are using local MySQL, make sure the MySQL server is running before starting the app.

Default local database settings:

```env
DB_HOST=127.0.0.1
DB_PORT=3306
DB_NAME=quiz_management_system
DB_USER=root
DB_PASSWORD=your_mysql_password
```

The app creates the configured database if the MySQL user has permission, then creates the required tables on startup.

## Run The Project

For development mode:

```bash
npm run dev
```

For normal start:

```bash
npm start
```

Then open the app in your browser:

```text
http://localhost:3000
```

## Important Notes


- Do not upload `node_modules` to GitHub.
- Do not upload your real `.env` file to GitHub.
- Another device only needs to run `npm install` after cloning the project.
- Keep `.env.example` in the repository so other users know which environment variables are required.

