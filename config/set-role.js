const path = require('path');
const mongoose = require('mongoose');
const { User } = require('@librechat/data-schemas').createModels(mongoose);
const { SystemRoles } = require('librechat-data-provider');
require('module-alias')({ base: path.resolve(__dirname, '..', 'api') });
const { askQuestion, silentExit } = require('./helpers');
const connect = require('./connect');

(async () => {
  await connect();

  console.purple('---------------------');
  console.purple('Set a user\'s role');
  console.purple('---------------------');

  const validRoles = Object.values(SystemRoles);

  let email = '';
  let role = '';

  if (process.argv.length >= 4) {
    email = process.argv[2];
    role = process.argv[3];
  } else {
    console.orange(`Usage: npm run set-role -- <email> <role>`);
    console.orange(`Valid roles: ${validRoles.join(', ')}`);
    console.orange('Note: if you do not pass in the arguments, you will be prompted for them.');
    console.purple('--------------------------');
  }

  if (!email) {
    email = await askQuestion('Email:');
  }

  if (!email.includes('@')) {
    console.red('Error: Invalid email address!');
    silentExit(1);
  }

  if (!role) {
    role = await askQuestion(`Role (${validRoles.join(' / ')}):`);
  }

  const normalizedRole = role.toUpperCase();
  if (!validRoles.includes(normalizedRole)) {
    console.red(`Error: Invalid role "${role}". Valid roles: ${validRoles.join(', ')}`);
    silentExit(1);
  }

  const user = await User.findOne({ email }).lean();
  if (!user) {
    console.red('Error: No user with that email was found!');
    silentExit(1);
  }
  console.purple(`Found user: ${user.email} (current role: ${user.role || 'USER'})`);

  if (user.role === normalizedRole) {
    console.yellow(`User is already ${normalizedRole}; nothing to do.`);
    silentExit(0);
  }

  if (user.role === SystemRoles.ADMIN && normalizedRole !== SystemRoles.ADMIN) {
    const remainingAdmins = await User.countDocuments({
      role: SystemRoles.ADMIN,
      _id: { $ne: user._id },
    });
    if (remainingAdmins === 0) {
      console.red('Error: refusing to demote the last remaining ADMIN.');
      silentExit(1);
    }
  }

  await User.updateOne({ _id: user._id }, { $set: { role: normalizedRole } });

  console.green(`Updated ${user.email}: ${user.role || 'USER'} -> ${normalizedRole}`);
  console.yellow('Note: the user must log out and back in for the new role to take effect.');

  silentExit(0);
})();

process.on('uncaughtException', (err) => {
  if (!err.message.includes('fetch failed')) {
    console.error('There was an uncaught error:');
    console.error(err);
  }

  if (err.message.includes('fetch failed')) {
    return;
  } else {
    process.exit(1);
  }
});
