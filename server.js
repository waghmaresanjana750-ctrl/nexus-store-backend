const express = require("express");

const app = express();

app.use(express.json());

app.get("/", (req, res) => {
  res.json({
    ok: true,
    message: "Nexus Store backend is working"
  });
});

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    message: "Backend is healthy"
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
