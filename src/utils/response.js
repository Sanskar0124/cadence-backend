// Utils
const logger = require('./winston');

const success = {
  SUCCESS: true,
  FAILURE: false,
};

const ResponseStatus = {
  SUCCESS: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  PAYMENT_REQUIRED: 402,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  UNPROCESSABLE_ENTITY: 422,
  ACCESS_DENIED: 440,
  INTERNAL_ERROR: 500,
};

const successResponse = ({ res, msg, data }) => {
  if (data) {
    res.status(ResponseStatus.SUCCESS).send({
      msg,
      data,
      correlationId: res.correlationId,
    });
    return;
  }
  res.status(ResponseStatus.SUCCESS).send({
    msg,
    correlationId: res.correlationId,
  });
};

const createdSuccessResponse = (res, msg, data) => {
  res.status(ResponseStatus.CREATED).send({
    msg,
    data,
  });
};

const notFoundResponse = (res, msg = 'Not found') => {
  res.status(ResponseStatus.NOT_FOUND).send({
    msg,
    correlationId: res.correlationId,
  });
};

const notFoundResponseWithDevMsg = ({ res, msg, error }) => {
  if (!msg)
    msg = 'Resource not found. Please try again later or contact support';
  if (!error) error = msg;
  res.status(ResponseStatus.NOT_FOUND).send({
    msg: msg,
    error: error,
    correlationId: res.correlationId,
  });
};

const unauthorizedResponse = (res, msg = 'Unauthorized') => {
  res.status(ResponseStatus.UNAUTHORIZED).send({
    msg,
    correlationId: res.correlationId,
  });
};

const unauthorizedResponseWithDevMsg = ({ res, msg, error }) => {
  if (!msg)
    msg = 'Unauthorized. Please check your credentials or contact support';
  if (!error) error = msg;
  res.status(ResponseStatus.UNAUTHORIZED).send({
    msg: msg,
    error: error,
    correlationId: res.correlationId,
  });
};

const badRequestResponse = (res, msg = 'Bad request') => {
  res.status(ResponseStatus.BAD_REQUEST).send({
    msg,
    correlationId: res.correlationId,
  });
};

const badRequestResponseWithDevMsg = ({ res, msg, error }) => {
  if (!msg) msg = 'Invalid request. Please try again later or contact support';
  if (!error) error = msg;
  res.status(ResponseStatus.BAD_REQUEST).send({
    msg: msg,
    error: error,
    correlationId: res.correlationId,
  });
};

const forbiddenResponse = (res, msg = 'Forbidden') => {
  res.status(ResponseStatus.FORBIDDEN).send({
    msg,
    correlationId: res.correlationId,
  });
};

const forbiddenResponseWithDevMsg = ({ res, msg, error }) => {
  if (!msg) msg = 'Access denied. Please contact support for assistance';
  if (!error) error = msg;
  res.status(ResponseStatus.FORBIDDEN).send({
    msg: msg,
    error: error,
    correlationId: res.correlationId,
  });
};

const serverErrorResponse = (res, msg = 'Internal server error') => {
  res.status(ResponseStatus.INTERNAL_ERROR).send({
    msg,
    correlationId: res.correlationId,
  });
};

const serverErrorResponseWithDevMsg = ({ res, msg, error }) => {
  if (!msg)
    msg = 'An error occurred, please try again later or contact support';
  if (!error) error = msg;
  res.status(ResponseStatus.INTERNAL_ERROR).send({
    msg: msg,
    error: error,
    correlationId: res.correlationId,
  });
};

const accessDeniedResponse = (res, msg = 'Access denied', data) => {
  res.status(ResponseStatus.ACCESS_DENIED).send({
    msg,
    data,
    correlationId: res.correlationId,
  });
};

const accessDeniedResponseWithDevMsg = ({ res, msg, error }) => {
  if (!msg) msg = 'Access denied. Please contact support for assistance';
  if (!error) error = msg;
  res.status(ResponseStatus.ACCESS_DENIED).send({
    msg: msg,
    error: error,
    correlationId: res.correlationId,
  });
};

const unprocessableEntityResponse = (res, msg = 'Unprocessable entity') => {
  res.status(ResponseStatus.UNPROCESSABLE_ENTITY).send({
    msg,
    correlationId: res.correlationId,
  });
};

const unprocessableEntityResponseWithDevMsg = ({ res, msg, error }) => {
  // so that we can see why JOI failed in logs while debugging
  if (error) logger.error(`JOI validation failed: ${error}`);
  if (!msg)
    msg =
      "We're unable to fulfill your request at this time. Please try again later or contact support";
  if (!error) error = msg;
  res.status(ResponseStatus.UNPROCESSABLE_ENTITY).send({
    msg: msg,
    error: error,
    correlationId: res.correlationId,
  });
};

const paymentRequiredResponse = (res, msg = 'Payment required') => {
  res.status(ResponseStatus.PAYMENT_REQUIRED).send({
    msg,
    correlationId: res.correlationId,
  });
};

const paymentRequiredResponseWithDevMsg = ({ res, msg, data, error }) => {
  if (!msg)
    msg =
      'Payment required. Please complete the payment process or contact support';
  if (!error) error = msg;
  res.status(ResponseStatus.PAYMENT_REQUIRED).send({
    msg: msg,
    data,
    error: error,
    correlationId: res.correlationId,
  });
};

module.exports = {
  successResponse,
  createdSuccessResponse,
  notFoundResponse,
  notFoundResponseWithDevMsg,
  unauthorizedResponse,
  unauthorizedResponseWithDevMsg,
  badRequestResponse,
  badRequestResponseWithDevMsg,
  forbiddenResponse,
  forbiddenResponseWithDevMsg,
  serverErrorResponse,
  serverErrorResponseWithDevMsg,
  accessDeniedResponse,
  accessDeniedResponseWithDevMsg,
  unprocessableEntityResponse,
  unprocessableEntityResponseWithDevMsg,
  paymentRequiredResponse,
  paymentRequiredResponseWithDevMsg,
};
