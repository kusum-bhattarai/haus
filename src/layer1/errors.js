export class Layer1ValidationError extends Error {
  constructor(message, details = []) {
    super(message);
    this.name = 'Layer1ValidationError';
    this.details = details;
  }
}

export function validationIssue(field, code, message) {
  return { field, code, message };
}
