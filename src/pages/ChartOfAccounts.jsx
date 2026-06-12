import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import ClientLayout from "../components/ClientLayout";
import { getStandardCoaAccounts } from "../appwrite/config";

export default function ChartOfAccounts() {

  const location = useLocation();
  const client = location.state?.client;

  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("All");
  const [expanded, setExpanded] = useState({});

  useEffect(() => {
    loadAccounts();
  }, []);

  async function loadAccounts() {
    try {
      const data = await getStandardCoaAccounts();
      setAccounts(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  const grouped = useMemo(() => {

    let filtered = accounts;

    if (filter !== "All") {
      filtered = filtered.filter(
        a => a.account_type === filter
      );
    }

    if (search.trim()) {
      const q = search.toLowerCase();

      filtered = filtered.filter(a =>
        a.account_name.toLowerCase().includes(q) ||
        a.account_code.toLowerCase().includes(q) ||
        a.category.toLowerCase().includes(q)
      );
    }

    const result = {};

    filtered.forEach(acc => {

      const type = acc.account_type;
      const category = acc.category;

      if (!result[type]) {
        result[type] = {};
      }

      if (!result[type][category]) {
        result[type][category] = [];
      }

      result[type][category].push(acc);
    });

    return result;

  }, [accounts, filter, search]);

  function toggle(key) {
    setExpanded(prev => ({
      ...prev,
      [key]: !prev[key]
    }));
  }

  const typeColors = {
    Asset: "#DBEAFE",
    Liability: "#FEE2E2",
    Equity: "#EDE9FE",
    Revenue: "#DCFCE7",
    Expense: "#FEF3C7"
  };

  if (loading) {
    return (
      <ClientLayout client={client}>
        Loading Chart of Accounts...
      </ClientLayout>
    );
  }

  return (
    <ClientLayout client={client}>

      <div>

        <div style={{
          display: "flex",
          justifyContent: "space-between",
          marginBottom: 20
        }}>

          <div>
            <h1>📒 Chart of Accounts</h1>

            <p style={{ color: "#64748B" }}>
              {accounts.length} Accounts
            </p>
          </div>

        </div>

        {/* Search */}

        <input
          placeholder="Search account..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            width: "100%",
            padding: 12,
            borderRadius: 10,
            border: "1px solid #CBD5E1",
            marginBottom: 16
          }}
        />

        {/* Filters */}

        <div style={{
          display: "flex",
          gap: 8,
          marginBottom: 20,
          flexWrap: "wrap"
        }}>

          {[
            "All",
            "Asset",
            "Liability",
            "Equity",
            "Revenue",
            "Expense"
          ].map(type => (

            <button
              key={type}
              onClick={() => setFilter(type)}
              style={{
                padding: "8px 14px",
                borderRadius: 20,
                border: "none",
                cursor: "pointer",
                background:
                  filter === type
                    ? "#2563EB"
                    : "#F1F5F9",

                color:
                  filter === type
                    ? "white"
                    : "#334155"
              }}
            >
              {type}
            </button>

          ))}

        </div>

        {/* COA Tree */}

        {Object.entries(grouped).map(([type, categories]) => (

          <div
            key={type}
            style={{
              marginBottom: 24,
              borderRadius: 12,
              overflow: "hidden",
              border: "1px solid #E2E8F0"
            }}
          >

            <div
              style={{
                background: typeColors[type],
                padding: 16,
                fontWeight: 700,
                fontSize: 18
              }}
            >
              {type}
            </div>

            {Object.entries(categories).map(([category, accs]) => {

              const key = `${type}-${category}`;

              return (

                <div key={category}>

                  <div
                    onClick={() => toggle(key)}
                    style={{
                      padding: 14,
                      cursor: "pointer",
                      background: "#F8FAFC",
                      borderTop: "1px solid #E2E8F0",
                      display: "flex",
                      justifyContent: "space-between"
                    }}
                  >
                    <strong>{category}</strong>

                    <span>
                      {accs.length} accounts
                      {" "}
                      {expanded[key] ? "▼" : "▶"}
                    </span>

                  </div>

                  {expanded[key] && (

                    accs.map(acc => (

                      <div
                        key={acc.$id}
                        style={{
                          display: "grid",
                          gridTemplateColumns:
                            "100px 1fr 100px 100px",

                          padding: 12,
                          borderTop:
                            "1px solid #F1F5F9",

                          alignItems: "center"
                        }}
                      >

                        <span>
                          {acc.account_code}
                        </span>

                        <span>
                          {acc.account_name}
                        </span>

                        <span>
                          {acc.normal_balance}
                        </span>

                        <span>
                          {acc.financial_statement}
                        </span>

                      </div>

                    ))

                  )}

                </div>

              );

            })}

          </div>

        ))}

      </div>

    </ClientLayout>
  );
}