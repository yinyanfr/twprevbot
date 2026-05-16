module.exports = {
  apps: [
    {
      name: "twprevbot",
      script: "dist/app.js",
      watch: false,
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
