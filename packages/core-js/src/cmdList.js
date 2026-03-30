/**
 * Runtime JS mirror for frutiparc/cmdList.as (global command aliases).
 */
const CMD_LIST = Object.freeze({
  error: 'a',
  serviceinfo: 'b',
  time: 'c',
  ip: 'd',
  ping: 'e',
  ident: 'k',
});

function createCmdList(overrides = {}) {
  return { ...CMD_LIST, ...overrides };
}

module.exports = {
  CMD_LIST,
  createCmdList,
};
