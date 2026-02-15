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
    // Check if this question contains "ظلل خانة غير متأكد" - always select NEUTRAL for this
    const firstRadio = group.radios[0];
    let shouldUseNeutral = false;
    if (firstRadio) {
      const row = firstRadio.closest('tr');
      if (row) {
        const rowText = row.textContent || '';
        if (rowText.includes('ظلل خانة غير متأكد')) {
          shouldUseNeutral = true;
        }
      }
    }
    
    let targetRadio: HTMLInputElement | null = null;
    
    if (shouldUseNeutral) {
      // Find the NEUTRAL option for this specific question
      const row = firstRadio.closest('tr');
      if (row) {
        // Look for radio buttons in this row that correspond to NEUTRAL
        const neutralRadios = group.radios.filter(radio => {
          const radioRow = radio.closest('tr');
          if (radioRow === row) {
            const cell = radio.closest('td, th');
            if (cell) {
              const cellText = cell.textContent || '';
              // Check if this cell contains "غير متأكد" or similar neutral indicators
              if (cellText.includes('غير متأكد') || cellText.includes('محايد')) {
                return true;
              }
            }
          }
          return false;
        });
        
        // If we found neutral radios, use the first one
        if (neutralRadios.length > 0) {
          targetRadio = neutralRadios[0];
        } else {
          // Fallback: use middle radio as neutral
          const midIndex = Math.floor(group.radios.length / 2);
          targetRadio = group.radios[midIndex];
        }
      }
    } else {
      // Use normal selection logic
      targetRadio = chooseRadioForGroup(group, tableMapping);
    }
    
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

  // Update table button text and select
  const tableButton = document.getElementById('qu-review-table-autofill-btn');
  const tableSelect = document.getElementById('qu-review-table-target-choice') as HTMLSelectElement;
  const buttonContainer = document.getElementById('qu-review-table-button');
  
  if (tableButton && !tableButton.disabled) {
    const buttonText = tableButton.querySelector('span:last-child');
    if (buttonText) {
      buttonText.textContent = getLanguage() === 'ar' ? 'ملء التقييم تلقائياً' : 'Review Auto Fill';
    }
    if (buttonContainer) {
      buttonContainer.style.direction = getLanguage() === 'ar' ? 'rtl' : 'ltr';
    }
  }
  
  if (tableSelect) {
    const currentValue = tableSelect.value;
    const label = buttonContainer?.querySelector('label');
    if (label) {
      label.textContent = getLanguage() === 'ar' ? 'نوع الملء:' : 'Fill Type:';
    }
    tableSelect.innerHTML = `
      <option value="AGREE">${t('agree')}</option>
      <option value="STRONGLY_AGREE">${t('stronglyAgree')}</option>
      <option value="NEUTRAL">${t('neutral')}</option>
      <option value="DISAGREE">${t('disagree')}</option>
      <option value="STRONGLY_DISAGREE">${t('stronglyDisagree')}</option>
    `;
    tableSelect.value = currentValue;
  }
}

/**
 * Inject button before a specific row element
 */
function injectButtonBeforeRow(row: HTMLTableRowElement) {
  // Check if button already exists
  if (document.getElementById('qu-review-table-button')) {
    console.log('QU Review Autofill: Button already exists, skipping injection');
    return;
  }

  // Validate row exists and is in DOM
  if (!row || !row.parentNode) {
    console.error('QU Review Autofill: Row is not in DOM or has no parent');
    return;
  }

  // Create button container with controls
  const buttonContainer = document.createElement('div');
  buttonContainer.id = 'qu-review-table-button';
  buttonContainer.style.cssText = `
    display: flex !important;
    flex-direction: column !important;
    gap: 10px !important;
    margin: 15px 0 !important;
    padding: 12px !important;
    background: #f8f9fa !important;
    border: 1px solid #e0e0e0 !important;
    border-radius: 6px !important;
    text-align: ${getLanguage() === 'ar' ? 'right' : 'left'} !important;
    direction: ${getLanguage() === 'ar' ? 'rtl' : 'ltr'} !important;
    font-family: 'Segoe UI', Tahoma, Arial, sans-serif !important;
  `;

  // Create select dropdown for target choice
  const isArabic = getLanguage() === 'ar';
  const selectContainer = document.createElement('div');
  selectContainer.style.cssText = `
    display: flex !important;
    align-items: center !important;
    gap: 12px !important;
    flex-direction: row !important;
    justify-content: flex-start !important;
    direction: ${isArabic ? 'rtl' : 'ltr'} !important;
    width: 100% !important;
    min-width: 0 !important;
    overflow: visible !important;
  `;

  // Create button instead of select dropdown
  const optionTexts = [
    { value: 'STRONGLY_AGREE', text: t('stronglyAgree') },
    { value: 'AGREE', text: t('agree') },
    { value: 'NEUTRAL', text: t('neutral') },
    { value: 'DISAGREE', text: t('disagree') },
    { value: 'STRONGLY_DISAGREE', text: t('stronglyDisagree') }
  ];
  
  // Get current selected text
  const getCurrentText = () => {
    const current = optionTexts.find(opt => opt.value === targetChoice);
    return current ? current.text : optionTexts[0].text;
  };
  
  const buttonWrapper = document.createElement('div');
  buttonWrapper.style.cssText = `
    position: relative !important;
    display: inline-block !important;
  `;
  
  const choiceButton = document.createElement('button');
  choiceButton.id = 'qu-review-table-target-choice';
  choiceButton.type = 'button';
  choiceButton.textContent = getCurrentText();
  
  const selectLabel = document.createElement('label');
  selectLabel.textContent = isArabic ? 'نوع الملء:' : 'Fill Type:';
  selectLabel.style.cssText = `
    font-weight: 600 !important;
    color: #333 !important;
    font-size: 15px !important;
    white-space: nowrap !important;
  `;
  
  // Get the default font from the page or a nearby element
  let defaultFontFamily = 'Arial, sans-serif';
  let defaultFontSize = '14px';
  let defaultColor = '#333';
  
  try {
    const bodyStyle = window.getComputedStyle(document.body);
    defaultFontFamily = bodyStyle.fontFamily || defaultFontFamily;
    defaultFontSize = bodyStyle.fontSize || defaultFontSize;
    defaultColor = bodyStyle.color || defaultColor;
    
    // Try to get style from a table cell or similar element
    const sampleElement = document.querySelector('td, .fontText, .fontTextMain');
    if (sampleElement) {
      const elemStyle = window.getComputedStyle(sampleElement);
      defaultFontFamily = elemStyle.fontFamily || defaultFontFamily;
      defaultFontSize = elemStyle.fontSize || defaultFontSize;
      defaultColor = elemStyle.color || defaultColor;
    }
  } catch (e) {
    console.warn('Could not get page styles:', e);
  }
  
  // Slightly larger font size for better readability
  const largerFontSize = parseFloat(defaultFontSize) > 13 ? `${parseFloat(defaultFontSize) + 1}px` : '14px';
  
  // Calculate width needed for the longest option text
  const tempSpan = document.createElement('span');
  tempSpan.style.cssText = `
    position: absolute !important;
    visibility: hidden !important;
    white-space: nowrap !important;
    font-size: ${largerFontSize} !important;
    font-family: ${defaultFontFamily} !important;
    padding: ${isArabic ? '8px 12px 8px 35px' : '8px 35px 8px 12px'} !important;
  `;
  document.body.appendChild(tempSpan);
  
  // Find the longest option text
  let maxWidth = 0;
  optionTexts.forEach(opt => {
    tempSpan.textContent = opt.text;
    const width = tempSpan.offsetWidth;
    if (width > maxWidth) {
      maxWidth = width;
    }
  });
  
  // Add extra padding for the dropdown arrow
  const extraPadding = isArabic ? 50 : 40;
  const calculatedWidth = Math.max(maxWidth + extraPadding, 250);
  document.body.removeChild(tempSpan);
  
  // Style the button
  choiceButton.style.cssText = `
    min-width: ${calculatedWidth}px !important;
    width: auto !important;
    padding: ${isArabic ? '8px 12px 8px 35px' : '8px 35px 8px 12px'} !important;
    border: 1px solid #999 !important;
    border-radius: 2px !important;
    font-size: ${largerFontSize} !important;
    font-weight: normal !important;
    background-color: #ffffff !important;
    color: ${defaultColor} !important;
    cursor: pointer !important;
    font-family: ${defaultFontFamily} !important;
    text-align: ${isArabic ? 'right' : 'left'} !important;
    direction: ${isArabic ? 'rtl' : 'ltr'} !important;
    line-height: 1.3 !important;
    white-space: nowrap !important;
    box-sizing: border-box !important;
    position: relative !important;
  `;
  
  // Create dropdown menu
  const dropdownMenu = document.createElement('div');
  dropdownMenu.id = 'qu-review-table-dropdown-menu';
  dropdownMenu.style.cssText = `
    display: none !important;
    position: absolute !important;
    top: 100% !important;
    ${isArabic ? 'right: 0' : 'left: 0'} !important;
    margin-top: 4px !important;
    min-width: ${calculatedWidth}px !important;
    background-color: #ffffff !important;
    border: 1px solid #999 !important;
    border-radius: 2px !important;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15) !important;
    z-index: 10000 !important;
    max-height: 300px !important;
    overflow-y: auto !important;
  `;
  
  // Create menu items
  optionTexts.forEach(opt => {
    const menuItem = document.createElement('div');
    menuItem.textContent = opt.text;
    menuItem.style.cssText = `
      padding: 10px 12px !important;
      cursor: pointer !important;
      font-size: ${largerFontSize} !important;
      font-weight: normal !important;
      color: ${defaultColor} !important;
      font-family: ${defaultFontFamily} !important;
      text-align: ${isArabic ? 'right' : 'left'} !important;
      direction: ${isArabic ? 'rtl' : 'ltr'} !important;
      border-bottom: 1px solid #f0f0f0 !important;
    `;
    
    // Highlight current selection
    if (opt.value === targetChoice) {
      menuItem.style.backgroundColor = '#f0f0f0';
    }
    
    // Hover effect
    menuItem.addEventListener('mouseenter', () => {
      menuItem.style.backgroundColor = '#f5f5f5';
    });
    menuItem.addEventListener('mouseleave', () => {
      menuItem.style.backgroundColor = opt.value === targetChoice ? '#f0f0f0' : '#ffffff';
    });
    
    // Click handler
    menuItem.addEventListener('click', () => {
      targetChoice = opt.value as TargetChoice;
      choiceButton.textContent = opt.text;
      dropdownMenu.style.display = 'none';
      
      // Update all menu items to show current selection
      dropdownMenu.querySelectorAll('div').forEach((item, idx) => {
        if (optionTexts[idx].value === targetChoice) {
          (item as HTMLElement).style.backgroundColor = '#f0f0f0';
        } else {
          (item as HTMLElement).style.backgroundColor = '#ffffff';
        }
      });
      
      // Save preference
      if (typeof chrome !== 'undefined' && chrome.storage) {
        chrome.storage.sync.set({ reviewTargetChoice: targetChoice });
      }
    });
    
    dropdownMenu.appendChild(menuItem);
  });
  
  // Toggle dropdown on button click
  choiceButton.addEventListener('click', (e) => {
    e.stopPropagation();
    const isVisible = dropdownMenu.style.display === 'block';
    dropdownMenu.style.display = isVisible ? 'none' : 'block';
  });
  
  // Close dropdown when clicking outside
  document.addEventListener('click', (e) => {
    if (!buttonWrapper.contains(e.target as Node)) {
      dropdownMenu.style.display = 'none';
    }
  });
  
  // Add dropdown arrow to button
  const arrow = document.createElement('span');
  arrow.textContent = isArabic ? '◄' : '▼';
  arrow.style.cssText = `
    position: absolute !important;
    ${isArabic ? 'left: 8px' : 'right: 8px'} !important;
    top: 50% !important;
    transform: translateY(-50%) !important;
    font-size: 10px !important;
    color: ${defaultColor} !important;
    pointer-events: none !important;
  `;
  choiceButton.style.position = 'relative';
  choiceButton.appendChild(arrow);
  
  buttonWrapper.appendChild(choiceButton);
  buttonWrapper.appendChild(dropdownMenu);
  
  // Button text is always visible, no need for this
  
  // With row-reverse: first appended = right side, second = left side
  // For Arabic: we want label on right, so append label first
  // For English: we want label on left, so append label first (normal order)
  selectContainer.appendChild(selectLabel);
  selectContainer.appendChild(buttonWrapper);

  // Create button with logo
  const button = document.createElement('button');
  button.id = 'qu-review-table-autofill-btn';
  
  // Create logo/icon (using checkmark emoji/icon)
  const logo = document.createElement('span');
  logo.innerHTML = '✓';
  logo.style.cssText = `
    display: inline-block !important;
    font-size: 16px !important;
    margin-${getLanguage() === 'ar' ? 'left' : 'right'}: 8px !important;
    vertical-align: middle !important;
    font-weight: bold !important;
  `;

  const buttonText = document.createElement('span');
  buttonText.textContent = getLanguage() === 'ar' ? 'ملء التقييم تلقائياً' : 'Review Auto Fill';
  
  // For Arabic, add logo after text; for English, before text
  if (getLanguage() === 'ar') {
    button.appendChild(buttonText);
    button.appendChild(logo);
  } else {
    button.appendChild(logo);
    button.appendChild(buttonText);
  }
  
  button.style.cssText = `
    padding: 10px 20px !important;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%) !important;
    color: white !important;
    border: none !important;
    border-radius: 6px !important;
    font-size: 14px !important;
    font-weight: 600 !important;
    cursor: pointer !important;
    transition: all 0.2s !important;
    font-family: 'Segoe UI', Tahoma, Arial, sans-serif !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    width: 100% !important;
    box-shadow: 0 2px 6px rgba(102, 126, 234, 0.3) !important;
    direction: ${getLanguage() === 'ar' ? 'rtl' : 'ltr'} !important;
    text-align: ${getLanguage() === 'ar' ? 'right' : 'left'} !important;
  `;

  // Add hover effect
  button.addEventListener('mouseenter', () => {
    button.style.transform = 'translateY(-2px)';
    button.style.boxShadow = '0 6px 16px rgba(102, 126, 234, 0.5)';
  });
  button.addEventListener('mouseleave', () => {
    button.style.transform = 'translateY(0)';
    button.style.boxShadow = '0 2px 8px rgba(102, 126, 234, 0.3)';
  });

  // Add click handler
  button.addEventListener('click', async () => {
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

    button.disabled = true;
    choiceButton.disabled = true;
    buttonText.textContent = getLanguage() === 'ar' ? 'جاري الملء...' : 'Filling...';

    const result = applySelection();

    if (result.success) {
      buttonText.textContent = getLanguage() === 'ar' 
        ? `تم ملء ${result.count} سؤال` 
        : `Filled ${result.count} questions`;
      button.style.background = '#38a169';
      setTimeout(() => {
        buttonText.textContent = getLanguage() === 'ar' ? 'ملء التقييم تلقائياً' : 'Review Auto Fill';
        button.style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
        button.disabled = false;
        choiceButton.disabled = false;
      }, 3000);
    } else {
      buttonText.textContent = result.error || t('noQuestions');
      button.style.background = '#e53e3e';
      setTimeout(() => {
        buttonText.textContent = getLanguage() === 'ar' ? 'ملء التقييم تلقائياً' : 'Review Auto Fill';
        button.style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
        button.disabled = false;
        choiceButton.disabled = false;
      }, 3000);
    }
  });

  buttonContainer.appendChild(selectContainer);
  buttonContainer.appendChild(button);

  // Insert button before the row
  try {
    if (row.parentNode) {
      row.parentNode.insertBefore(buttonContainer, row);
      console.log('QU Review Autofill: Button injected before row');
      
      // Verify button was actually inserted
      const insertedButton = document.getElementById('qu-review-table-button');
      if (insertedButton) {
        console.log('QU Review Autofill: Button successfully injected and verified in DOM');
      } else {
        console.error('QU Review Autofill: Button injection failed - button not found in DOM');
      }
    } else {
      console.error('QU Review Autofill: Row has no parent node');
    }
  } catch (error) {
    console.error('QU Review Autofill: Error injecting button:', error);
  }
}

/**
 * Find the course info table and inject review autofill button next to it
 */
function injectTableButton() {
  // Check if button already exists
  if (document.getElementById('qu-review-table-button')) {
    console.log('QU Review Autofill: Button already exists, skipping injection');
    return;
  }

  console.log('QU Review Autofill: Attempting to find target row...');
  console.log('QU Review Autofill: Current URL:', window.location.href);

  // Strategy 1: Look for the row containing "أسئلة خاصة ببداية المقرر"
  const allRows = Array.from(document.querySelectorAll('tr'));
  console.log(`QU Review Autofill: Found ${allRows.length} tr elements`);
  
  const targetRow = allRows.find(row => {
    const text = row.textContent || '';
    return text.includes('أسئلة خاصة ببداية المقرر');
  });

  if (targetRow) {
    console.log('QU Review Autofill: Found target row with "أسئلة خاصة ببداية المقرر"');
    console.log('QU Review Autofill: Row element:', targetRow);
    console.log('QU Review Autofill: Row parent:', targetRow.parentNode);
    injectButtonBeforeRow(targetRow);
    return;
  }

  console.log('QU Review Autofill: Target row not found, trying alternative strategies...');

  // Strategy 1: Look for tbody with fontText class (specific to the provided HTML structure)
  const allTbodies = Array.from(document.querySelectorAll('tbody'));
  console.log(`QU Review Autofill: Found ${allTbodies.length} tbody elements`);
  
  // Log all tbody contents for debugging
  allTbodies.forEach((tbody, index) => {
    const text = tbody.textContent || '';
    const hasFontText = tbody.querySelector('.fontText') !== null;
    const hasFontTextMain = tbody.querySelector('.fontTextMain') !== null;
    console.log(`QU Review Autofill: tbody[${index}]: hasFontText=${hasFontText}, hasFontTextMain=${hasFontTextMain}, text preview: ${text.substring(0, 100)}`);
  });
  
  const tbodyWithFontText = allTbodies.find(tbody => {
    const hasFontText = tbody.querySelector('.fontText') !== null;
    if (hasFontText) {
      console.log('QU Review Autofill: Found tbody with .fontText class');
    }
    return hasFontText;
  });

  if (tbodyWithFontText) {
    const table = tbodyWithFontText.closest('table');
    if (table) {
      console.log('QU Review Autofill: Found table with fontText, injecting button');
      console.log('QU Review Autofill: Table element:', table);
      console.log('QU Review Autofill: Table parent:', table.parentNode);
      injectButtonAfterTable(table);
      return;
    } else {
      console.warn('QU Review Autofill: Found tbody with fontText but no table parent');
    }
  }

  // Strategy 3: Find table containing course info (المقر, الشعبة, اسم المقرر, النشاط)
  const allTables = Array.from(document.querySelectorAll('table'));
  console.log(`QU Review Autofill: Checking ${allTables.length} tables for course info...`);
  
  for (let i = 0; i < allTables.length; i++) {
    const table = allTables[i];
    const tbody = table.querySelector('tbody');
    if (!tbody) {
      console.log(`QU Review Autofill: Table[${i}] has no tbody, skipping`);
      continue;
    }

    // Check if this table contains the course info structure
    // The terms may be in different rows, so check across all rows
    const tbodyText = tbody.textContent || '';
    const hasالمقر = tbodyText.includes('المقر');
    const hasالشعبة = tbodyText.includes('الشعبة');
    const hasاسمالمقرر = tbodyText.includes('اسم المقرر');
    const hasالنشاط = tbodyText.includes('النشاط');

    console.log(`QU Review Autofill: Table[${i}] check - المقر: ${hasالمقر}, الشعبة: ${hasالشعبة}, اسم المقرر: ${hasاسمالمقرر}, النشاط: ${hasالنشاط}`);

    if (hasالمقر && hasالشعبة && hasاسمالمقرر && hasالنشاط) {
      console.log('QU Review Autofill: Found matching table, injecting button');
      console.log('QU Review Autofill: Table element:', table);
      console.log('QU Review Autofill: Table parent:', table.parentNode);
      injectButtonAfterTable(table);
      return; // Only inject once
    }
  }

  // Strategy 4: Look for any tbody with fontTextMain class (alternative structure)
  const tbodyWithFontTextMain = allTbodies.find(tbody => {
    return tbody.querySelector('.fontTextMain') !== null;
  });

  if (tbodyWithFontTextMain) {
    const table = tbodyWithFontTextMain.closest('table');
    if (table) {
      console.log('QU Review Autofill: Found table with fontTextMain, injecting button');
      injectButtonAfterTable(table);
      return;
    }
  }

  // Strategy 5: Look for any element containing the specific text pattern
  console.log('QU Review Autofill: Trying Strategy 4 - searching for text patterns...');
  const allElements = Array.from(document.querySelectorAll('*'));
  const matchingElement = allElements.find(el => {
    const text = el.textContent || '';
    return text.includes('المقر') && text.includes('الشعبة') && text.includes('اسم المقرر') && text.includes('النشاط');
  });

  if (matchingElement) {
    console.log('QU Review Autofill: Found element with course info text:', matchingElement);
    const table = matchingElement.closest('table');
    if (table) {
      console.log('QU Review Autofill: Found table via text search, injecting button');
      injectButtonAfterTable(table);
      return;
    }
  }

  console.log('QU Review Autofill: Could not find course info table after all strategies');
  console.log('QU Review Autofill: Page HTML structure may be different than expected');
}

/**
 * Inject the button after a table element (specifically after the tbody)
 */
function injectButtonAfterTable(table: HTMLTableElement) {
  // Validate table exists and is in DOM
  if (!table || !table.parentNode) {
    console.error('QU Review Autofill: Table is not in DOM or has no parent');
    return;
  }

  // Find the tbody with fontText class
  const tbody = table.querySelector('tbody');
  if (!tbody) {
    console.warn('QU Review Autofill: Table has no tbody, skipping injection');
    return;
  }

  // Create button container
  const buttonContainer = document.createElement('div');
  buttonContainer.id = 'qu-review-table-button';
  buttonContainer.style.cssText = `
    display: block !important;
    margin: 15px 0 !important;
    text-align: ${getLanguage() === 'ar' ? 'right' : 'left'} !important;
    direction: ${getLanguage() === 'ar' ? 'rtl' : 'ltr'} !important;
  `;

  const button = document.createElement('button');
  button.id = 'qu-review-table-autofill-btn';
  button.textContent = getLanguage() === 'ar' ? 'ملء التقييم تلقائياً' : 'Review Auto Fill';
  button.style.cssText = `
    padding: 10px 20px !important;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%) !important;
    color: white !important;
    border: none !important;
    border-radius: 6px !important;
    font-size: 14px !important;
    font-weight: 500 !important;
    cursor: pointer !important;
    transition: all 0.2s !important;
    font-family: 'Segoe UI', Tahoma, Arial, sans-serif !important;
  `;

  // Add hover effect
  button.addEventListener('mouseenter', () => {
    button.style.transform = 'translateY(-1px)';
    button.style.boxShadow = '0 4px 12px rgba(102, 126, 234, 0.4)';
  });
  button.addEventListener('mouseleave', () => {
    button.style.transform = 'translateY(0)';
    button.style.boxShadow = 'none';
  });

  // Add click handler
  button.addEventListener('click', async () => {
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

    button.disabled = true;
    button.textContent = getLanguage() === 'ar' ? 'جاري الملء...' : 'Filling...';

    const result = applySelection();

    if (result.success) {
      button.textContent = getLanguage() === 'ar' 
        ? `✓ تم ملء ${result.count} سؤال` 
        : `✓ Filled ${result.count} questions`;
      button.style.background = '#38a169';
      setTimeout(() => {
        button.textContent = getLanguage() === 'ar' ? 'ملء التقييم تلقائياً' : 'Review Auto Fill';
        button.style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
        button.disabled = false;
      }, 3000);
    } else {
      button.textContent = result.error || t('noQuestions');
      button.style.background = '#e53e3e';
      setTimeout(() => {
        button.textContent = getLanguage() === 'ar' ? 'ملء التقييم تلقائياً' : 'Review Auto Fill';
        button.style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
        button.disabled = false;
      }, 3000);
    }
  });

  buttonContainer.appendChild(button);

  // Insert button right after the table (appears visually under the tbody)
  // Use a more defensive approach to avoid breaking page scripts
  try {
    // Wait a bit to ensure page scripts have finished initializing
    setTimeout(() => {
      try {
        if (!table.parentNode) {
          console.warn('QU Review Autofill: Table lost parent node, using fallback');
          if (document.body) {
            document.body.appendChild(buttonContainer);
            console.log('QU Review Autofill: Button injected to body as fallback');
          }
          return;
        }

        // Insert after the table
        if (table.nextSibling) {
          table.parentNode.insertBefore(buttonContainer, table.nextSibling);
        } else {
          // No next sibling, append after table
          table.parentNode.appendChild(buttonContainer);
        }
        console.log('QU Review Autofill: Button injected after table (using parentNode)');
        
        // Verify button was actually inserted
        const insertedButton = document.getElementById('qu-review-table-button');
        if (insertedButton) {
          console.log('QU Review Autofill: Button successfully injected and verified in DOM');
        } else {
          console.error('QU Review Autofill: Button injection failed - button not found in DOM');
        }
      } catch (insertError) {
        console.error('QU Review Autofill: Error during button insertion:', insertError);
        // Last resort: try appending to body
        try {
          if (document.body) {
            document.body.appendChild(buttonContainer);
            console.log('QU Review Autofill: Button injected to body as fallback');
          }
        } catch (bodyError) {
          console.error('QU Review Autofill: Failed to inject button to body:', bodyError);
        }
      }
    }, 100); // Small delay to let page scripts initialize
  } catch (error) {
    console.error('QU Review Autofill: Error in button injection wrapper:', error);
  }
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
        const choiceButton = document.querySelector<HTMLButtonElement>('#qu-review-table-target-choice');
        if (choiceButton) {
          // Update button text to match current selection
          const optionTexts = [
            { value: 'STRONGLY_AGREE', text: t('stronglyAgree') },
            { value: 'AGREE', text: t('agree') },
            { value: 'NEUTRAL', text: t('neutral') },
            { value: 'DISAGREE', text: t('disagree') },
            { value: 'STRONGLY_DISAGREE', text: t('stronglyDisagree') }
          ];
          const current = optionTexts.find(opt => opt.value === targetChoice);
          if (current) {
            choiceButton.textContent = current.text;
            // Keep the arrow if it exists
            const arrow = choiceButton.querySelector('span');
            if (arrow && !arrow.textContent) {
              // Arrow exists, restore it
              const isArabic = getLanguage() === 'ar';
              arrow.textContent = isArabic ? '◄' : '▼';
            }
          }
        }
      }
    });
  }

  // Don't create floating widget - user requested to remove it
  // Only inject button next to course info table

  // Wait for page scripts to initialize before injecting button
  // This prevents interfering with page's own JavaScript
  setTimeout(() => {
    console.log('QU Review Autofill: Initializing, attempting to inject button...');
    injectTableButton();
  }, 500);
  
  // Retry injection after delays to handle dynamically loaded content
  setTimeout(() => {
    console.log('QU Review Autofill: Retry 1 (1.5s delay)');
    injectTableButton();
  }, 1500);
  setTimeout(() => {
    console.log('QU Review Autofill: Retry 2 (3s delay)');
    injectTableButton();
  }, 3000);
  setTimeout(() => {
    console.log('QU Review Autofill: Retry 3 (5s delay)');
    injectTableButton();
  }, 5000);
  setTimeout(() => {
    console.log('QU Review Autofill: Retry 4 (10s delay)');
    injectTableButton();
  }, 10000);

  // Monitor for dynamic content loading
  let retryTimeout: number | null = null;
  const observer = new MutationObserver(() => {
    // Debounce table button injection to avoid excessive calls
    if (!document.getElementById('qu-review-table-button')) {
      if (retryTimeout) {
        clearTimeout(retryTimeout);
      }
      retryTimeout = window.setTimeout(() => {
        injectTableButton();
      }, 500);
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
}

// Prevent multiple executions
if ((window as any).__QU_REVIEW_AUTOFILL_LOADED__) {
  console.warn('QU Review Autofill: Script already loaded, skipping initialization');
} else {
  (window as any).__QU_REVIEW_AUTOFILL_LOADED__ = true;
  
  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}

