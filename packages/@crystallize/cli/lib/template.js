'use strict';

const {
  logDebug,
  logError,
  logInfo,
  logSuccess,
  shouldUseYarn,
  cloneRepository
} = require('@crystallize/cli-utils');
const chalk = require('chalk');
const Conf = require('conf');
const execSync = require('child_process').execSync;
const fs = require('fs-extra');
const inquirer = require('inquirer');
const isEqual = require('lodash/isEqual');
const os = require('os');
const path = require('path');
const spawn = require('cross-spawn');
const { boilerplates } = require('./boilerplate');

const config = new Conf({ projectName: 'crystallize' });
const defaultOptions = config.get('defaults', {});

const templates = [
  {
    name: 'Next.js + React',
    value: 'nextjs-react',
    type: 'react'
  }
];

const rootQuestions = [
  {
    type: 'list',
    name: 'shopToUse',
    message: 'Which shop do you want to use?',
    choices: [
      {
        value: 'demo',
        name: 'The demo shop - prefilled with lots of data'
      },
      'My very own tenant please'
    ]
  },
  {
    type: 'input',
    name: 'tenantId',
    message: 'Your tenant ID (https://crystallize.com/signup)',
    default: 'demo',
    when: answers => answers.shopToUse !== 'demo'
  },
  {
    type: 'list',
    name: 'template',
    message: 'Which template would you like to use?',
    choices: templates
  }
];

const reduceOptions = answers =>
  answers.options.reduce((obj, item) => {
    obj[item] = true;
    return obj;
  }, {});

const reactTemplateQuestions = [
  {
    type: 'checkbox',
    name: 'options',
    message: 'Which features would you like to use?',
    default: 'javascript',
    choices: [
      // TODO: TypeScript template
      // {
      //   name: 'Use TypeScript',
      //   value: 'typescript',
      //   checked: defaultOptions.react && defaultOptions.react.typescript
      // },
      {
        name: 'Use Now (https://zeit.co/now) for deployments',
        value: 'useNow',
        checked: defaultOptions.react && defaultOptions.react.useNow
      }
    ]
  },
  {
    type: 'confirm',
    name: 'saveDefaults',
    message: 'Save these template settings as default?',
    default: true,
    when: answers => {
      const options = reduceOptions(answers);
      return !isEqual(defaultOptions.react, options);
    }
  }
];

/**
 * Determines the type of project to be created and calls the corresponding
 * setup script for the matching template.
 *
 * @param {string} projectName The name of the project
 * @param {string} projectPath The path of the project
 * @param {object} flags Flags specified via the cli
 */
const createTemplateProject = async (projectName, projectPath, flags) => {
  const answers = await inquirer.prompt(rootQuestions);
  const template = templates.find(t => t.value === answers.template);
  if (template.type === 'react') {
    await createReactProject(projectName, projectPath, answers.tenantId, flags);
  } else {
    logError(`Unknown template type: "${template.type}`);
    process.exit(1);
  }
};

/**
 * Creates a new React project and asks React project specific questions.
 *
 * @param {string} projectName The name of the project
 * @param {string} projectPath The path of the project
 * @param {string} tenantId The id of the shop to use
 * @param {object} flags Flags specified via the cli
 */
const createReactProject = async (
  projectName,
  projectPath,
  tenantId,
  flags
) => {
  const answers = await inquirer.prompt(reactTemplateQuestions);
  const options = reduceOptions(answers);

  if (answers.saveDefaults) {
    logInfo('Saving default template preferences');
    config.set('defaults.react', options);
  }

  const templateOptions = {
    tenantId,
    useNow: options.useNow,
    useTypescript: options.typescript
  };

  cloneRepository(boilerplates['react'], projectPath);
  logInfo(`Creating a new Crystallize project in ${chalk.green(projectPath)}`);

  process.chdir(projectPath);

  const oldPackageJson = fs.readFileSync(path.resolve('package.json'), 'utf-8');
  const oldPackageJsonObj = JSON.parse(oldPackageJson);

  const scripts = oldPackageJsonObj.scripts;
  delete scripts['postinstall'];
  delete scripts['greet'];

  if (templateOptions.useNow) {
    delete oldPackageJsonObj.dependencies['express'];
    delete oldPackageJsonObj.dependencies['cookie-parser'];
    scripts['dev'] = scripts['now-dev'];
  } else {
    delete oldPackageJsonObj.dependencies['now'];
    delete oldPackageJsonObj.dependencies['@nerdenough/mjml-ncc-bundle'];
  }

  delete scripts['now-dev'];

  const dependencies = Object.keys(oldPackageJsonObj.dependencies).concat(
    '@crystallize/react-scripts'
  );
  const devDependencies = Object.keys(oldPackageJsonObj.devDependencies);

  const packageJson = {
    name: projectName,
    version: '0.1.0',
    private: true,
    scripts
  };

  fs.writeFileSync(
    path.resolve(projectPath, 'package.json'),
    JSON.stringify(packageJson, null, 2) + os.EOL
  );

  // Install dependencies
  const useYarn = !flags.useNpm && shouldUseYarn();
  installNodeDependencies(useYarn, dependencies, devDependencies);

  if (process.env.DEV) {
    // Link the package instead of npm install
    logDebug('Running "npm link @crystallize/react-scripts"');
    execSync('npm link @crystallize/react-scripts', {
      stdio: 'inherit'
    });
  }

  // Run project's init script
  const scriptsPath = path.resolve(
    process.cwd(),
    'node_modules/@crystallize/react-scripts/scripts/init.js'
  );
  const init = require(scriptsPath);
  init(projectPath, templateOptions);

  showInstructions(projectPath, useYarn, templateOptions);
};

/**
 * Installs Node dependencies using either npm or Yarn.
 *
 * @param {boolean} useYarn Should Yarn be used for installing dependencies?
 * @param {array} dependencies Array of dependencies to install
 */
const installNodeDependencies = (useYarn, dependencies, devDependencies) => {
  let command;
  let dependencyArgs;
  let devDependencyArgs;

  if (useYarn) {
    logInfo(`Installing dependencies with yarn: ${dependencies.join(', ')}`);
    command = 'yarnpkg';
    dependencyArgs = ['add'].concat(dependencies);
    devDependencyArgs = ['add', '-D'].concat(devDependencies);
  } else {
    logInfo(`Installing dependencies with npm: ${dependencies.join(', ')}`);
    command = 'npm';
    dependencyArgs = ['install', '--save', '--loglevel', 'error'].concat(
      dependencies
    );
    devDependencyArgs = [
      'install',
      '--save',
      '-D',
      '--loglevel',
      'error'
    ].concat(devDependencies);
  }

  spawn.sync(command, dependencyArgs, { stdio: 'inherit' });
  return spawn.sync(command, devDependencyArgs, { stdio: 'inherit' });
};

/**
 * Shows the postinstall instructions on the screen, such as how to run the
 * project in dev and prod modes.
 *
 * @param {string} projectPath The path of the project
 * @param {string} useYarn Should the commands be shown as yarn or npm?
 * @param {object} templateOptions User specified template configuration
 */
const showInstructions = (projectPath, useYarn, templateOptions) => {
  console.log();
  logSuccess(`Done! Your project has been created in ${projectPath}`);
  console.log();
  console.log(
    `Use ${chalk.green(
      useYarn ? 'yarn dev' : 'npm run dev'
    )} to run the app in development mode`
  );
  console.log(
    `Use ${chalk.green(
      useYarn ? 'yarn prod' : 'npm run prod'
    )} to run the app in production mode`
  );

  console.log();

  if (templateOptions.useNow) {
    console.log(
      `Install now globally with ${chalk.green(
        useYarn ? 'yarn global add now' : 'npm install --global now'
      )}`
    );
    console.log(
      `Deploy to Now (https://zeit.co/now) by running ${chalk.green('now')}`
    );
  }
};

module.exports = {
  createTemplateProject
};
