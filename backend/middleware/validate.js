/**
 * Middleware to validate route parameter as a positive integer.
 * Responds with 400 if validation fails.
 */
function validateParamId(paramName) {
  return (req, res, next) => {
    const rawVal = req.params[paramName];
    // Check if the parameter is a strictly positive integer
    if (!rawVal || !/^[1-9]\d*$/.test(rawVal)) {
      return res.status(400).json({ error: `Invalid ${paramName}` });
    }
    req.params[paramName] = parseInt(rawVal, 10);
    next();
  };
}

module.exports = {
  validateParamId,
};
