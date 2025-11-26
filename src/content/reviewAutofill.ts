/**
 * Content script for QU course review autofill
 * Adds a floating widget to auto-fill Likert scale radio buttons
 */

type TargetChoice = 'STRONGLY_AGREE' | 'AGREE' | 'NEUTRAL' | 'DISAGREE' | 'STRONGLY_DISAGREE';
type LikertValue = 'STRONGLY_AGREE' | 'AGREE' | 'NEUTRAL' | 'DISAGREE' | 'STRONGLY_DISAGREE';

interface RadioGroup {
  name: string;
  radios: HTMLInputElement[];
  checkedRadio: HTMLInputElement | null;
}

interface LikertTableMapping {
  [key: string]: number; // column index for each Likert value
}

interface Snapshot {
  [groupName: string]: {
    radioId: string | null;
    value: string | null;
  };
}

// Translations
const translations = {
  en: {
    title: 'Course Review Helper',
    targetChoice: 'Target Choice',
    agreeAll: 'Fill All',
    undo: 'Undo',
    confirmTitle: 'Confirm Action',
    confirmMessage: 'This will fill all questions with "{choice}". Continue?',
    successMessage: 'Successfully filled {count} questions.',
    noQuestions: 'No questions found',
    stronglyAgree: 'Strongly Agree',
    agree: 'Agree',
    neutral: 'Unsure',
    disagree: 'Disagree',
    stronglyDisagree: 'Strongly Disagree',
  },
  ar: {
    title: 'مساعد تقييم المقرر',
    targetChoice: 'الخيار المستهدف',
    agreeAll: 'ملء الكل',
    undo: 'تراجع',
    confirmTitle: 'تأكيد الإجراء',
    confirmMessage: 'سيتم ملء جميع الأسئلة بـ "{choice}". متابعة؟',
    successMessage: 'تم ملء {count} سؤال بنجاح.',
    noQuestions: 'لم يتم العثور على أسئلة',
    stronglyAgree: 'موافق بشدة',
    agree: 'موافق',
    neutral: 'غير متأكد',
    disagree: 'غير موافق',
    stronglyDisagree: 'غير موافق بشدة',
  },
};

// Get language from storage or default to Arabic
let currentLanguage: 'en' | 'ar' = 'ar';

function getLanguage(): 'en' | 'ar' {
  return currentLanguage;
}

function t(key: keyof typeof translations.en): string {
  return translations[getLanguage()][key];
}

// Load language preference
if (typeof chrome !== 'undefined' && chrome.storage) {
  chrome.storage.sync.get(['language'], (result) => {
    if (result.language === 'en' || result.language === 'ar') {
      currentLanguage = result.language;
      updateWidgetText();
    }
  });

  // Listen for language changes
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'sync' && changes.language) {
      const newLang = changes.language.newValue;
      if (newLang === 'en' || newLang === 'ar') {
        currentLanguage = newLang;
        updateWidgetText();
      }
    }
  });
}

// State
let targetChoice: TargetChoice = 'AGREE';
let snapshot: Snapshot | null = null;

/**
 * Group radio inputs by their name attribute
 */
function groupRadiosByName(): RadioGroup[] {
  const allRadios = Array.from(
    document.querySelectorAll<HTMLInputElement>('input[type="radio"][name]')
  );

  const groupsMap = new Map<string, HTMLInputElement[]>();

  allRadios.forEach((radio) => {
    const name = radio.name;
    if (!groupsMap.has(name)) {
      groupsMap.set(name, []);
    }
    groupsMap.get(name)!.push(radio);
  });

  return Array.from(groupsMap.entries()).map(([name, radios]) => ({
    name,
    radios,
    checkedRadio: radios.find((r) => r.checked) || null,
  }));
}

/**
 * Detect Likert scale table mapping by analyzing header row
 */
function detectLikertTableMapping(): LikertTableMapping | null {
  // Find tables that might contain Likert scales
  const tables = Array.from(document.querySelectorAll('table'));

  for (const table of tables) {
    // Find header row (usually first row or thead)
    const headerRow = table.querySelector('thead tr, tr:first-child');
    if (!headerRow) continue;

    const headerCells = Array.from(headerRow.querySelectorAll('th, td'));
    const mapping: LikertTableMapping = {};

    headerCells.forEach((cell, index) => {
      const text = (cell.textContent || '').trim();

      // Map Arabic Likert scale labels
      if (text.includes('موافق بشدة') && !text.includes('غير')) {
        mapping.STRONGLY_AGREE = index;
      } else if (text.includes('موافق') && !text.includes('بشدة') && !text.includes('غير')) {
        mapping.AGREE = index;
      } else if (text.includes('غير متأكد')) {
        mapping.NEUTRAL = index;
      } else if (text.includes('غير موافق') && !text.includes('بشدة')) {
        mapping.DISAGREE = index;
      } else if (text.includes('غير موافق بشدة')) {
        mapping.STRONGLY_DISAGREE = index;
      }
    });

    // If we found at least one Likert value, this is likely a Likert table
    if (Object.keys(mapping).length > 0) {
      return mapping;
    }
  }

  return null;
}

/**
 * Choose the appropriate radio for a group based on target choice
 */
function chooseRadioForGroup(
  group: RadioGroup,
  tableMapping: LikertTableMapping | null
): HTMLInputElement | null {
  if (group.radios.length === 0) return null;

  // Strategy A: Use table mapping if available
  if (tableMapping) {
    const targetColumn = tableMapping[targetChoice];
    if (targetColumn !== undefined) {
      // Find the radio in the target column
      // We need to find which row this radio group belongs to
      const firstRadio = group.radios[0];
      const row = firstRadio.closest('tr');
      if (row) {
        const cells = Array.from(row.querySelectorAll('td, th'));
        if (cells[targetColumn]) {
          const targetCell = cells[targetColumn];
          const radioInCell = targetCell.querySelector<HTMLInputElement>(
            `input[type="radio"][name="${group.name}"]`
          );
          if (radioInCell) return radioInCell;
        }
      }
    }
  }

  // Strategy B: Fallback to value-based or DOM order heuristic
  // Try numeric values first
  const radiosWithValues = group.radios
    .map((r) => ({ radio: r, value: parseInt(r.value, 10) }))
    .filter((r) => !isNaN(r.value))
    .sort((a, b) => b.value - a.value);

  if (radiosWithValues.length > 0) {
    switch (targetChoice) {
      case 'STRONGLY_AGREE':
        return radiosWithValues[0].radio; // Max value
      case 'AGREE':
        return radiosWithValues.length > 1 ? radiosWithValues[1].radio : radiosWithValues[0].radio;
      case 'NEUTRAL':
        // Middle value
        const midIndex = Math.floor(radiosWithValues.length / 2);
        return radiosWithValues[midIndex].radio;
      case 'DISAGREE':
        // Second min (second from end)
        return radiosWithValues.length > 1 
          ? radiosWithValues[radiosWithValues.length - 2].radio 
          : radiosWithValues[radiosWithValues.length - 1].radio;
      case 'STRONGLY_DISAGREE':
        return radiosWithValues[radiosWithValues.length - 1].radio; // Min value
    }
  }

  // Strategy C: DOM order heuristic
  const radioCount = group.radios.length;
  switch (targetChoice) {
    case 'STRONGLY_AGREE':
      return group.radios[radioCount - 1]; // Last radio
    case 'AGREE':
      return radioCount > 1 ? group.radios[radioCount - 2] : group.radios[0];
    case 'NEUTRAL':
      // Middle radio
      const midIndex = Math.floor(radioCount / 2);
      return group.radios[midIndex];
    case 'DISAGREE':
      // Second first (second radio)
      return radioCount > 1 ? group.radios[1] : group.radios[0];
    case 'STRONGLY_DISAGREE':
      return group.radios[0]; // First radio
  }
  
  return null;
}

/**
 * Apply selection to all radio groups
 */
function applySelection(): { success: boolean; count: number; error?: string } {
  const groups = groupRadiosByName();
  if (groups.length === 0) {
    return { success: false, count: 0, error: t('noQuestions') };
  }

  const tableMapping = detectLikertTableMapping();
  let filledCount = 0;

  // Take snapshot before applying
  snapshot = {};
  groups.forEach((group) => {
    snapshot[group.name] = {
      radioId: group.checkedRadio?.id || null,
      value: group.checkedRadio?.value || null,
    };
  });

  // Apply selections
  groups.forEach((group) => {
    const targetRadio = chooseRadioForGroup(group, tableMapping);
    if (targetRadio && !targetRadio.checked) {
      // Click to trigger all site listeners
      targetRadio.click();

      // Also dispatch change event to ensure all listeners fire
      const changeEvent = new Event('change', { bubbles: true });
      targetRadio.dispatchEvent(changeEvent);

      filledCount++;
    } else if (targetRadio && targetRadio.checked) {
      // Already selected, count it
      filledCount++;
    }
  });

  return { success: true, count: filledCount };
}

/**
 * Restore previous selections from snapshot
 */
function undoSelection(): { success: boolean; count: number } {
  if (!snapshot) {
    return { success: false, count: 0 };
  }

  const groups = groupRadiosByName();
  let restoredCount = 0;

  groups.forEach((group) => {
    const saved = snapshot![group.name];
    if (!saved) return;

    // Try to find the saved radio by ID first, then by value
    let targetRadio: HTMLInputElement | null = null;

    if (saved.radioId) {
      targetRadio = document.getElementById(saved.radioId) as HTMLInputElement;
    }

    if (!targetRadio && saved.value) {
      targetRadio = group.radios.find((r) => r.value === saved.value) || null;
    }

    if (targetRadio && targetRadio !== group.checkedRadio) {
      targetRadio.click();
      const changeEvent = new Event('change', { bubbles: true });
      targetRadio.dispatchEvent(changeEvent);
      restoredCount++;
    } else if (!targetRadio && group.checkedRadio) {
      // If we can't find the saved radio, uncheck current
      group.checkedRadio.checked = false;
      const changeEvent = new Event('change', { bubbles: true });
      group.checkedRadio.dispatchEvent(changeEvent);
      restoredCount++;
    }
  });

  snapshot = null;
  return { success: true, count: restoredCount };
}

/**
 * Create and inject the floating widget
 */
function createWidget(): HTMLElement {
  // Check if widget already exists
  const existing = document.getElementById('qu-review-autofill-widget');
  if (existing) {
    return existing;
  }

  const widget = document.createElement('div');
  widget.id = 'qu-review-autofill-widget';
  widget.innerHTML = `
    <div class="qu-review-widget-header">
      <span class="qu-review-widget-title">${t('title')}</span>
    </div>
    <div class="qu-review-widget-body">
      <div class="qu-review-widget-control">
        <label for="qu-review-target-choice">${t('targetChoice')}:</label>
        <select id="qu-review-target-choice">
          <option value="AGREE">${t('agree')}</option>
          <option value="STRONGLY_AGREE">${t('stronglyAgree')}</option>
          <option value="NEUTRAL">${t('neutral')}</option>
          <option value="DISAGREE">${t('disagree')}</option>
          <option value="STRONGLY_DISAGREE">${t('stronglyDisagree')}</option>
        </select>
      </div>
      <div class="qu-review-widget-actions">
        <button id="qu-review-agree-all" class="qu-review-btn qu-review-btn-primary">
          ${t('agreeAll')}
        </button>
        <button id="qu-review-undo" class="qu-review-btn qu-review-btn-secondary">
          ${t('undo')}
        </button>
      </div>
      <div id="qu-review-status" class="qu-review-status"></div>
    </div>
  `;

  // Add styles
  const style = document.createElement('style');
  style.textContent = `
    #qu-review-autofill-widget {
      position: fixed !important;
      bottom: 20px !important;
      right: 20px !important;
      width: 280px !important;
      background: #ffffff !important;
      border: 1px solid #e2e8f0 !important;
      border-radius: 12px !important;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15) !important;
      z-index: 999999 !important;
      font-family: 'Segoe UI', Tahoma, Arial, sans-serif !important;
      font-size: 14px !important;
      direction: ${getLanguage() === 'ar' ? 'rtl' : 'ltr'} !important;
    }
    .qu-review-widget-header {
      padding: 12px 16px !important;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%) !important;
      border-radius: 12px 12px 0 0 !important;
      color: white !important;
      font-weight: 600 !important;
    }
    .qu-review-widget-body {
      padding: 16px !important;
    }
    .qu-review-widget-control {
      margin-bottom: 12px !important;
    }
    .qu-review-widget-control label {
      display: block !important;
      margin-bottom: 6px !important;
      color: #4a5568 !important;
      font-weight: 500 !important;
    }
    #qu-review-target-choice {
      width: 100% !important;
      padding: 8px 12px !important;
      border: 1px solid #cbd5e0 !important;
      border-radius: 6px !important;
      font-size: 14px !important;
      background: white !important;
      color: #2d3748 !important;
    }
    .qu-review-widget-actions {
      display: flex !important;
      gap: 8px !important;
      margin-bottom: 12px !important;
    }
    .qu-review-btn {
      flex: 1 !important;
      padding: 10px 16px !important;
      border: none !important;
      border-radius: 6px !important;
      font-size: 14px !important;
      font-weight: 500 !important;
      cursor: pointer !important;
      transition: all 0.2s !important;
    }
    .qu-review-btn-primary {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%) !important;
      color: white !important;
    }
    .qu-review-btn-primary:hover {
      transform: translateY(-1px) !important;
      box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4) !important;
    }
    .qu-review-btn-secondary {
      background: #e2e8f0 !important;
      color: #4a5568 !important;
    }
    .qu-review-btn-secondary:hover {
      background: #cbd5e0 !important;
    }
    .qu-review-btn:disabled {
      opacity: 0.5 !important;
      cursor: not-allowed !important;
    }
    .qu-review-status {
      min-height: 20px !important;
      font-size: 12px !important;
      color: #718096 !important;
      text-align: center !important;
    }
    .qu-review-status.success {
      color: #38a169 !important;
    }
    .qu-review-status.error {
      color: #e53e3e !important;
    }
  `;
  document.head.appendChild(style);

  // Add event listeners
  const targetChoiceSelect = widget.querySelector<HTMLSelectElement>('#qu-review-target-choice');
  const agreeAllBtn = widget.querySelector<HTMLButtonElement>('#qu-review-agree-all');
  const undoBtn = widget.querySelector<HTMLButtonElement>('#qu-review-undo');
  const statusDiv = widget.querySelector<HTMLDivElement>('#qu-review-status');

  if (targetChoiceSelect) {
    targetChoiceSelect.value = targetChoice;
    targetChoiceSelect.addEventListener('change', (e) => {
      targetChoice = (e.target as HTMLSelectElement).value as TargetChoice;
      // Save preference
      if (typeof chrome !== 'undefined' && chrome.storage) {
        chrome.storage.sync.set({ reviewTargetChoice: targetChoice });
      }
    });
  }

  if (agreeAllBtn) {
    agreeAllBtn.addEventListener('click', async () => {
      // Get choice text based on target choice
      let choiceText = '';
      switch (targetChoice) {
        case 'STRONGLY_AGREE':
          choiceText = t('stronglyAgree');
          break;
        case 'AGREE':
          choiceText = t('agree');
          break;
        case 'NEUTRAL':
          choiceText = t('neutral');
          break;
        case 'DISAGREE':
          choiceText = t('disagree');
          break;
        case 'STRONGLY_DISAGREE':
          choiceText = t('stronglyDisagree');
          break;
        default:
          choiceText = t('agree');
      }
      const confirmed = window.confirm(
        `${t('confirmTitle')}\n\n${t('confirmMessage').replace('{choice}', choiceText)}`
      );

      if (!confirmed) return;

      agreeAllBtn.disabled = true;
      if (statusDiv) {
        statusDiv.textContent = '';
        statusDiv.className = 'qu-review-status';
      }

      const result = applySelection();

      if (result.success) {
        if (statusDiv) {
          statusDiv.textContent = t('successMessage').replace('{count}', result.count.toString());
          statusDiv.className = 'qu-review-status success';
        }
        undoBtn!.disabled = false;
      } else {
        if (statusDiv) {
          statusDiv.textContent = result.error || t('noQuestions');
          statusDiv.className = 'qu-review-status error';
        }
      }

      agreeAllBtn.disabled = false;
    });
  }

  if (undoBtn) {
    undoBtn.disabled = true;
    undoBtn.addEventListener('click', () => {
      const result = undoSelection();
      if (statusDiv) {
        if (result.success && result.count > 0) {
          statusDiv.textContent = `Restored ${result.count} questions.`;
          statusDiv.className = 'qu-review-status success';
        } else {
          statusDiv.textContent = 'Nothing to undo.';
          statusDiv.className = 'qu-review-status';
        }
      }
      undoBtn.disabled = true;
    });
  }

  return widget;
}

/**
 * Update widget text when language changes
 */
function updateWidgetText() {
  const widget = document.getElementById('qu-review-autofill-widget');
  if (!widget) return;

  const title = widget.querySelector('.qu-review-widget-title');
  const targetLabel = widget.querySelector('.qu-review-widget-control label');
  const agreeAllBtn = widget.querySelector('#qu-review-agree-all');
  const undoBtn = widget.querySelector('#qu-review-undo');
  const targetSelect = widget.querySelector<HTMLSelectElement>('#qu-review-target-choice');

  if (title) title.textContent = t('title');
  if (targetLabel) targetLabel.textContent = t('targetChoice') + ':';
  if (agreeAllBtn) agreeAllBtn.textContent = t('agreeAll');
  if (undoBtn) undoBtn.textContent = t('undo');

  // Update select options
  if (targetSelect) {
    const currentValue = targetSelect.value;
    targetSelect.innerHTML = `
      <option value="AGREE">${t('agree')}</option>
      <option value="STRONGLY_AGREE">${t('stronglyAgree')}</option>
      <option value="NEUTRAL">${t('neutral')}</option>
      <option value="DISAGREE">${t('disagree')}</option>
      <option value="STRONGLY_DISAGREE">${t('stronglyDisagree')}</option>
    `;
    targetSelect.value = currentValue; // Restore selection
  }

  // Update direction
  widget.style.direction = getLanguage() === 'ar' ? 'rtl' : 'ltr';
}

/**
 * Initialize the widget
 */
function init() {
  // Only run on stu-gate.qu.edu.sa
  if (!window.location.hostname.includes('stu-gate.qu.edu.sa')) {
    return;
  }

  // Load saved target choice preference
  if (typeof chrome !== 'undefined' && chrome.storage) {
    chrome.storage.sync.get(['reviewTargetChoice'], (result) => {
      const validChoices: TargetChoice[] = ['STRONGLY_AGREE', 'AGREE', 'NEUTRAL', 'DISAGREE', 'STRONGLY_DISAGREE'];
      if (result.reviewTargetChoice && validChoices.includes(result.reviewTargetChoice as TargetChoice)) {
        targetChoice = result.reviewTargetChoice as TargetChoice;
        const select = document.querySelector<HTMLSelectElement>('#qu-review-target-choice');
        if (select) {
          select.value = targetChoice;
        }
      }
    });
  }

  // Create and inject widget
  const widget = createWidget();
  document.body.appendChild(widget);

  // Monitor for dynamic content loading
  const observer = new MutationObserver(() => {
    // Widget is already mounted, just ensure it's visible
    const existing = document.getElementById('qu-review-autofill-widget');
    if (!existing && document.body) {
      document.body.appendChild(createWidget());
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

