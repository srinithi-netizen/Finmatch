// src/components/MonthYearPicker.jsx
const MONTHS = [
  { value: 1,  label: "January" },
  { value: 2,  label: "February" },
  { value: 3,  label: "March" },
  { value: 4,  label: "April" },
  { value: 5,  label: "May" },
  { value: 6,  label: "June" },
  { value: 7,  label: "July" },
  { value: 8,  label: "August" },
  { value: 9,  label: "September" },
  { value: 10, label: "October" },
  { value: 11, label: "November" },
  { value: 12, label: "December" },
];

export function getYearOptions() {
  const currentYear = new Date().getFullYear();
  const years = [];
  for (let y = currentYear + 1; y >= currentYear - 5; y--) years.push(y);
  return years;
}

export default function MonthYearPicker({ month, year, onChange, label = "Period" }) {
  const years = getYearOptions();
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      {label && (
        <span style={{ fontSize: 12, fontWeight: 600, color: "#6b7280", whiteSpace: "nowrap" }}>
          📅 {label}:
        </span>
      )}
      <select
        value={month ?? ""}
        onChange={(e) => onChange(e.target.value ? parseInt(e.target.value) : null, year)}
        style={{ padding: "6px 10px", border: "1px solid #e5e7eb", borderRadius: 8, fontSize: 12, background: "#fff", cursor: "pointer" }}
      >
        <option value="">All Months</option>
        {MONTHS.map((m) => (
          <option key={m.value} value={m.value}>{m.label}</option>
        ))}
      </select>
      <select
        value={year ?? ""}
        onChange={(e) => onChange(month, e.target.value ? parseInt(e.target.value) : null)}
        style={{ padding: "6px 10px", border: "1px solid #e5e7eb", borderRadius: 8, fontSize: 12, background: "#fff", cursor: "pointer" }}
      >
        <option value="">All Years</option>
        {years.map((y) => (
          <option key={y} value={y}>{y}</option>
        ))}
      </select>
      {(month || year) && (
        <button
          onClick={() => onChange(null, null)}
          style={{ fontSize: 11, color: "#ef4444", background: "none", border: "none", cursor: "pointer", padding: "2px 6px" }}
        >
          ✕ Clear
        </button>
      )}
    </div>
  );
}