const mongoose = require('mongoose');

const settingsSchema = new mongoose.Schema({
  // Email settings
  email: {
    type: String,
    trim: true,
    lowercase: true
  },
  brevoApiKey: {
    type: String,
    default: ''
  },
  senderEmail: {
    type: String,
    default: ''
  },
  // Password for settings access
  password: {
    type: String,
    default: ''
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Settings', settingsSchema);
