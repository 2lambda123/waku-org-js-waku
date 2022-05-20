process.env.CHROME_BIN = require("puppeteer").executablePath();
const webpackConfig = require("./webpack.config.cjs");

module.exports = function (config) {
  config.set({
    frameworks: ["webpack", "mocha"],
    files: ["src/lib/**/!(node).spec.ts"],
    preprocessors: {
      "src/lib/**/!(node).spec.ts": ["env", "webpack"],
    },
    envPreprocessor: ["CI"],
    reporters: ["progress"],
    browsers: ["ChromeHeadless"],
    singleRun: true,
    client: {
      mocha: {
        timeout: 6000, // Default is 2s
      },
    },
    webpack: {
      mode: "production",
      module: webpackConfig.module,
      plugins: webpackConfig.plugins,
      resolve: webpackConfig.resolve,
      stats: { warnings: false },
    },
  });
};
