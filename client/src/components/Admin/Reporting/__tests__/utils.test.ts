import { tokenValueToUSD, formatCreditsWithUSD, formatNumber, tableToCSV } from '../utils';

describe('Reporting Utils', () => {
  describe('tokenValueToUSD', () => {
    it('should convert tokenValue to USD correctly (EDGE-002)', () => {
      expect(tokenValueToUSD(5000000)).toBe(5.0);
      expect(tokenValueToUSD(1000000)).toBe(1.0);
      expect(tokenValueToUSD(0)).toBe(0);
      expect(tokenValueToUSD(12500)).toBe(0.0125);
    });
  });

  describe('formatCreditsWithUSD', () => {
    it('should format token credits with USD equivalent (REQ-012)', () => {
      const result = formatCreditsWithUSD(12500);
      expect(result).toContain('12,500');
      expect(result).toContain('credits');
      expect(result).toContain('$');
    });

    it('should handle zero', () => {
      const result = formatCreditsWithUSD(0);
      expect(result).toContain('0');
      expect(result).toContain('credits');
    });
  });

  describe('formatNumber', () => {
    it('should format numbers with locale separators', () => {
      expect(formatNumber(1234567)).toBe('1,234,567');
      expect(formatNumber(0)).toBe('0');
    });
  });

  describe('tableToCSV', () => {
    it('should generate correct CSV output (REQ-014)', () => {
      const headers = ['Name', 'Value'];
      const rows = [
        { name: 'Alice', value: 100 },
        { name: 'Bob', value: 200 },
      ];
      const columns = ['name', 'value'];
      const csv = tableToCSV(headers, rows, columns);
      expect(csv).toBe('Name,Value\nAlice,100\nBob,200');
    });

    it('should quote values containing commas', () => {
      const headers = ['Name', 'Value'];
      const rows = [{ name: 'Smith, John', value: 100 }];
      const columns = ['name', 'value'];
      const csv = tableToCSV(headers, rows, columns);
      expect(csv).toContain('"Smith, John"');
    });

    it('should handle empty rows', () => {
      const headers = ['Name'];
      const csv = tableToCSV(headers, [], ['name']);
      expect(csv).toBe('Name');
    });

    it('should sanitize values starting with formula characters to prevent CSV injection', () => {
      const headers = ['Name', 'Value'];
      const rows = [
        { name: '=CMD("calc")', value: 100 },
        { name: '+1234', value: 200 },
        { name: '-1234', value: 300 },
        { name: '@SUM(A1:A2)', value: 400 },
      ];
      const columns = ['name', 'value'];
      const csv = tableToCSV(headers, rows, columns);
      const lines = csv.split('\n');
      expect(lines[1]).toContain("'=CMD");
      expect(lines[2]).toContain("'+1234");
      expect(lines[3]).toContain("'-1234");
      expect(lines[4]).toContain("'@SUM");
    });

    it('should not sanitize normal values', () => {
      const headers = ['Name'];
      const rows = [{ name: 'Alice' }];
      const columns = ['name'];
      const csv = tableToCSV(headers, rows, columns);
      expect(csv).toBe('Name\nAlice');
    });
  });
});
