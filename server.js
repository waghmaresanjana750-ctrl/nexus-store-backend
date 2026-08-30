const express = require("express");

const app = express();

app.use(express.json());

app.get("/api/health", (req, res) => {
    res.json({
        ok: true,
        message: "NEXUS STORE backend is working"
    });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`NEXUS STORE backend running on port ${PORT}`);
});
