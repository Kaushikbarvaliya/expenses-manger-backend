const { Types } = require('mongoose');

/**
 * Generate next recurring date based on frequency
 * @param {Date} baseDate - User-specified start date
 * @param {string} frequency - 'daily'|'weekly'|'monthly' 
 * @returns {Date} Next occurrence date
 */
function generateNextDate(baseDate, frequency) {
  const date = new Date(baseDate);

  switch (frequency) {
    case 'weekly':
      date.setDate(date.getDate() + 7);
      break;
    case 'monthly':
      // Keep same DAY (user-specified date logic)
      date.setMonth(date.getMonth() + 1);
      // Handle month overflow (31 → Feb → 28th)
      if (date.getDate() !== baseDate.getDate()) {
        date.setDate(1); // Reset to 1st if overflow
      }
      break;
    default:
      throw new Error(`Unknown frequency: ${frequency}`);
  }

  return date;
}

/**
 * Create 12 future recurring expense instances from base
 * @param {Object} baseExpense - Original expense data
 * @param {number} periods - How many future instances (default 12)
 * @returns {Array} Array of generated expenses (ready for DB)
 */
async function createRecurringChain(baseExpense, periods = 12) {
  if (!baseExpense.recurring || !baseExpense.frequency) {
    throw new Error('Base expense must have recurring=true and valid frequency');
  }

  const generated = [];
  let currentDate = new Date(baseExpense.date);

  for (let i = 1; i <= periods; i++) {
    currentDate = generateNextDate(currentDate, baseExpense.frequency);

    const instance = {
      ...baseExpense,
      _id: new Types.ObjectId(), // New Mongo ID for each
      date: currentDate,
      name: `${baseExpense.name} (Auto-${baseExpense.frequency})`,
      note: baseExpense.note ? `${baseExpense.note} [Generated #${i}]` : `[Generated #${i}]`,
      createdAt: new Date(), // Fresh timestamp
      updatedAt: new Date(),
      isGenerated: true, // Custom flag for frontend
    };

    generated.push(instance);
  }

  return generated;
}

/**
 * Filter expenses for display (show base + first recurring only)
 * @param {Array} allExpenses - Full expense list from DB
 * @returns {Array} Display-friendly list
 */
function getDisplayExpenses(allExpenses) {
  const baseExpenses = [];
  const seenBase = new Set();

  allExpenses.forEach(exp => {
    // Skip generated instances except first per base pattern
    if (exp.isGenerated && seenBase.has(exp.name)) {
      return;
    }

    baseExpenses.push(exp);
    if (exp.recurring) {
      seenBase.add(exp.name); // Mark pattern as shown
    }
  });

  return baseExpenses.sort((a, b) => new Date(b.date) - new Date(a.date));
}

module.exports = {
  generateNextDate,
  createRecurringChain,
  getDisplayExpenses,
};

