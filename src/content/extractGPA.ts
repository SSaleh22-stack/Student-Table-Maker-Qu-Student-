/**
 * Extract GPA data from QU student portal GPA page
 */

export interface GPAData {
  cumulativeGPA: number;
  earnedHours: number;
  termNumber: string;
}

export function extractGPAFromDom(doc: Document): GPAData | null {
  try {
    // Find all semester sections (each is in a <tr> containing tables)
    const allRows = doc.querySelectorAll('tr');
    const semesterData: Array<{ termNumber: number; gpa: number; hours: number }> = [];

    allRows.forEach((row) => {
      // Look for the term number in text like "الفصل الأول 1447&nbsp;&nbsp;(471)"
      const termText = row.textContent || '';
      const termMatch = termText.match(/\((\d+)\)/);
      if (!termMatch) return;

      const termNumber = parseInt(termMatch[1]);

      // Find the cumulative summary table within this row
      const cumulativeTable = row.querySelector('table[id*="osama"]');
      if (!cumulativeTable) return;

      // Find the "تراكمي" (Cumulative) row
      const tableRows = cumulativeTable.querySelectorAll('tbody tr');
      let cumulativeGPA = 0;
      let earnedHours = 0;

      tableRows.forEach((tr) => {
        const cells = tr.querySelectorAll('td');
        if (cells.length < 6) return;

        const firstCellText = cells[0].textContent?.trim() || '';
        // Check if this is the cumulative row (تراكمي)
        if (firstCellText.includes('تراكمي')) {
          // Columns: الساعات المسجلة, الساعات المكتسبة, الساعات المجتازة, النقاط, المعدل
          // Index: 0 (label), 1 (registered), 2 (earned), 3 (passed), 4 (points), 5 (GPA)
          const hoursText = cells[2]?.textContent?.trim() || '0';
          const gpaText = cells[5]?.textContent?.trim() || '0';

          earnedHours = parseFloat(hoursText.replace(/[^\d.]/g, '')) || 0;
          cumulativeGPA = parseFloat(gpaText.replace(/[^\d.]/g, '')) || 0;
        }
      });

      // Always add term data, even if GPA is 0 (for latest term detection)
      semesterData.push({ termNumber, gpa: cumulativeGPA, hours: earnedHours });
    });

    if (semesterData.length === 0) {
      return null;
    }

    // Sort by term number (descending - latest first)
    semesterData.sort((a, b) => b.termNumber - a.termNumber);

    // Take the latest term (471) - even if it has no GPA
    let selectedData = semesterData[0];
    
    // If the latest term has no GPA (gpa === 0), use the second biggest term (462)
    if (selectedData.gpa === 0 && semesterData.length >= 2) {
      selectedData = semesterData[1]; // Second biggest term
    }

    if (!selectedData) {
      return null;
    }

    return {
      cumulativeGPA: selectedData.gpa,
      earnedHours: selectedData.hours,
      termNumber: selectedData.termNumber.toString(),
    };
  } catch (error) {
    console.error('Error extracting GPA data:', error);
    return null;
  }
}

