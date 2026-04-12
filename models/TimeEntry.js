const mongoose = require('mongoose');

const timeEntrySchema = new mongoose.Schema({
  entryId: {
    type: Number,
    required: true,
    unique: true
  },
  date: {
    type: String,
    required: true
  },
  client: {
    type: String,
    required: true
  },
  time: {
    type: String,
    required: true
  },
  task: {
    type: String,
    required: true
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('TimeEntry', timeEntrySchema);
