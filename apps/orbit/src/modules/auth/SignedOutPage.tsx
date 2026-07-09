const AUTH_LOGIN = "/api/auth/login";

const BTN: React.CSSProperties = {
  display: "inline-block",
  padding: "8px 24px",
  borderRadius: 6,
  background: "linear-gradient(135deg, #7C3AED, #4361EE)",
  color: "#fff",
  fontSize: 14,
  fontFamily: "var(--app-font-sans, system-ui, sans-serif)",
  fontWeight: 500,
  textDecoration: "none",
  cursor: "pointer",
};

export function SignedOutPage() {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        background: "#0B1120",
        color: "#E5E7EB",
        fontFamily: "var(--app-font-sans, system-ui, sans-serif)",
        padding: 24,
      }}
    >
      <div style={{ maxWidth: 440, textAlign: "center" }}>
        <div
          style={{
            width: 52,
            height: 52,
            borderRadius: "50%",
            background: "linear-gradient(135deg, #7C3AED, #4361EE)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            margin: "0 auto 20px",
            fontSize: 22,
            fontWeight: 700,
          }}
        >
          O
        </div>
        <div style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>
          You have been signed out
        </div>
        <p style={{ fontSize: 14, color: "#9CA3AF", marginBottom: 24, lineHeight: 1.6 }}>
          Your Orbit session has ended. Sign in again to continue.
        </p>
        <a href={AUTH_LOGIN} style={BTN}>
          Sign in
        </a>
      </div>
    </div>
  );
}
