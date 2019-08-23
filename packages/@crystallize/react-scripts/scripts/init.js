'use strict';

const chalk = require('chalk');
const execSync = require('child_process').execSync;
const fs = require('fs-extra');
const path = require('path');

const initialiseRepository = () => {
  console.log(chalk.blue('info'), 'Initialising git repository');
  try {
    execSync('git init', { stdio: 'ignore' });
    execSync('git add -A', { stdio: 'ignore' });
    execSync('git commit -m "Initial commit"', { stdio: 'ignore' });
  } catch (err) {
    // Perhaps git is not installed
    console.error(
      chalk.yellow('warning'),
      'Unable to initialise a git repository, skipping'
    );
    return false;
  }
};

const init = (projectPath, projectName, options) => {
  const { useNow, useTypescript } = options;

  const { name: ownPackageName } = require(path.resolve(
    __dirname,
    '..',
    'package.json'
  ));
  const ownPath = path.resolve(projectPath, 'node_modules', ownPackageName);
  const appPackage = require(path.resolve(projectPath, 'package.json'));

  appPackage.scripts = {
    build: 'next build',
    start: 'node ./server'
  };

  appPackage.dependencies = appPackage.dependencies || {};
  appPackage.devDependencies = appPackage.devDependencies || {};

  if (useNow) {
    appPackage.scripts = {
      ...appPackage.scripts,
      deploy: 'now',
      start: 'now dev'
    };
  }

  fs.writeFileSync(
    path.resolve(projectPath, 'package.json'),
    JSON.stringify(appPackage, null, 2)
  );

  const templatePath = path.resolve(
    ownPath,
    useTypescript ? 'template-typescript' : 'template'
  );

  if (!fs.existsSync(templatePath)) {
    console.log(
      chalk.red('error'),
      'Could not locate the supplied template:',
      chalk.green(templatePath)
    );
    return;
  }

  fs.copySync(templatePath, projectPath);
  configureTemplate(projectPath, options);

  initialiseRepository();
};

/**
 * Configures the project by adding, removing, and renaming files as needed.
 *
 * @param {string} projectPath
 * @param {object} options
 */
const configureTemplate = (projectPath, options) => {
  // Remove unnecessary server files
  if (options.useNow) {
    fs.removeSync(path.resolve(projectPath, 'server'));
  } else {
    fs.removeSync(path.resolve(projectPath, 'pages', 'api'));
    fs.removeSync(path.resolve(projectPath, 'now.json'));
  }

  // Rename gitignore to .gitignore
  fs.moveSync(
    path.resolve(projectPath, 'gitignore'),
    path.resolve(projectPath, '.gitignore')
  );
};

module.exports = init;
