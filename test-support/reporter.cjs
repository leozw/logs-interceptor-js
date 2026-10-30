module.exports = async function* (events) {
  for await (const event of events) yield JSON.stringify(event, (_key, value) => value instanceof Error ? { name: value.name, message: value.message, stack: value.stack, cause: value.cause } : value) + '\n';
};
