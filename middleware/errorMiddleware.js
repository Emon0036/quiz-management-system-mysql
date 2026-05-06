function notFound(req, res, next) {
  const error = new Error(`Page not found: ${req.originalUrl}`);
  error.status = 404;
  next(error);
}

function errorHandler(error, req, res, next) {
  const status = error.status || 500;
  if (status >= 500) {
    console.error(error);
  }

  res.status(status).render('error', {
    title: status === 404 ? 'Page not found' : 'Server error',
    message: status === 404 ? 'The page you requested does not exist.' : 'Something went wrong. Please try again.',
  });
}

module.exports = { notFound, errorHandler };
