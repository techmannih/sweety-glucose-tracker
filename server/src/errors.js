export class HttpError extends Error {
  constructor(status, message, fields) {
    super(message);
    this.status = status;
    this.fields = fields;
  }
}
export function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);
  if (error.type === 'entity.parse.failed')
    return res.status(400).json({ message: 'Request body must be valid JSON.' });
  if (error.type === 'entity.too.large')
    return res.status(413).json({ message: 'Request is too large.' });
  if (error instanceof HttpError)
    return res.status(error.status).json({ message: error.message, fields: error.fields });
  if (error.code === '23505')
    return res.status(409).json({ message: 'This entry already exists.' });
  console.error('Request failed:', error.code || error.name);
  res.status(500).json({ message: 'Something went wrong. Please try again.' });
}
