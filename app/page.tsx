export default function Home() {
  return (
    <main style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      minHeight: "100vh",
      background: "#f7f3f4",
      fontFamily: "Nunito Sans, sans-serif"
    }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>🦁</div>
        <h1 style={{
          fontFamily: "Nunito, sans-serif",
          fontSize: 32,
          fontWeight: 900,
          color: "#1a0d12",
          marginBottom: 8
        }}>
          Roam Growth Engine
        </h1>
        <p style={{ color: "#9e7e88", fontSize: 16, fontWeight: 500 }}>
          Platform is running ✓
        </p>
      </div>
    </main>
  );
}
