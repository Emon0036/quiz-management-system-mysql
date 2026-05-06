const util = require('util');

function flashMiddleware(req, res, next) {
  req.flash = (type, message, ...args) => {
    if (!req.session) {
      throw new Error('req.flash() requires sessions');
    }

    const messages = req.session.flash || {};
    req.session.flash = messages;

    if (!type) {
      req.session.flash = {};
      return messages;
    }

    if (message === undefined) {
      const storedMessages = messages[type] || [];
      delete messages[type];
      return storedMessages;
    }

    const values = Array.isArray(message)
      ? message
      : [args.length ? util.format(message, ...args) : message];

    messages[type] = messages[type] || [];
    messages[type].push(...values);
    return messages[type].length;
  };

  next();
}

module.exports = flashMiddleware;
