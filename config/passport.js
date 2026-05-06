const LocalStrategy = require('passport-local').Strategy;
const User = require('../models/User');

module.exports = (passport) => {
  passport.use(
    new LocalStrategy({ usernameField: 'email' }, async (email, password, done) => {
      try {
        const user = await User.findOne({ email: email.toLowerCase() }).select('+password');
        if (!user || !user.password) return done(null, false, { message: 'Invalid email or password.' });
        if (user.accountStatus === 'blocked') {
          return done(null, false, { message: 'Your account has been blocked. Please contact an administrator.' });
        }

        const passwordMatches = await user.matchPassword(password);
        if (!passwordMatches) return done(null, false, { message: 'Invalid email or password.' });

        return done(null, user);
      } catch (error) {
        return done(error);
      }
    })
  );

  passport.serializeUser((user, done) => done(null, user.id));

  passport.deserializeUser(async (id, done) => {
    try {
      done(null, await User.findById(id));
    } catch (error) {
      done(error);
    }
  });
};
