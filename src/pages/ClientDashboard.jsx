import { useLocation } from "react-router-dom";
import ClientLayout from "../components/ClientLayout";

export default function ClientDashboard() {
  const location = useLocation();
  const client = location.state?.client;

  if (!client) return <div>Client not found</div>;

  return (
    <ClientLayout client={client}>
      <h1>Welcome back, {client.client_name}</h1>

      <p>Here's today's accounting summary</p>

      {/* Dashboard widgets */}
    </ClientLayout>
  );
}