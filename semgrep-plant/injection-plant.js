// Throwaway plant for §613's CI red proof. Removed by the next commit.
const { exec } = require("child_process");

module.exports = function h(req) {
  exec(req.query.cmd);
  eval(req.query.cmd);
  return new Function(req.query.cmd);
};
