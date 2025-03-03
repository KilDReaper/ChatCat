require("dotenv").config();
const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const axios = require("axios");
const pool = require("./db");

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("🚀 Chatbot API is running...");
});
app.post("/api/register", async (req, res) => {
  try {
    const { username, email, password } = req.body;
    if (!username || !email || !password) {
      return res.status(400).json({ error: "Username, email, and password are required" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await pool.query(
      "INSERT INTO users (username, email, password) VALUES ($1, $2, $3) RETURNING id, username, email",
      [username, email, hashedPassword]
    );

    res.status(201).json({ message: "User registered successfully", user: result.rows[0] });
  } catch (error) {
    console.error("Registration Error:", error.message);
    res.status(500).json({ error: "Server error during registration" });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const { identifier, password } = req.body;
    if (!identifier || !password) {
      return res.status(400).json({ error: "Username/Email and password are required" });
    }

    const user = await pool.query("SELECT * FROM users WHERE username = $1 OR email = $1", [identifier]);
    if (user.rows.length === 0) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const validPassword = await bcrypt.compare(password, user.rows[0].password);
    if (!validPassword) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    res.json({ message: "Login successful", user: { id: user.rows[0].id, username: user.rows[0].username, email: user.rows[0].email } });
  } catch (error) {
    console.error("Login Error:", error.message);
    res.status(500).json({ error: "Server error during login" });
  }
});

app.post("/api/chat", async (req, res) => {
  try {
    if (!process.env.HF_API_KEY) {
      console.error("❌ Hugging Face API Key is missing.");
      return res.status(500).json({ error: "Chatbot service misconfiguration" });
    }

    const userMessage = req.body.message;
    if (!userMessage) {
      return res.status(400).json({ error: "No message provided" });
    }

    console.log("📩 User Message Received:", userMessage);

    const response = await axios.post(
      "https://api-inference.huggingface.co/models/facebook/blenderbot-3B",
      { inputs: userMessage },
      { headers: { Authorization: `Bearer ${process.env.HF_API_KEY}` } }
    );

    console.log("📩 API Response:", response.data);

    if (!response.data || !Array.isArray(response.data) || !response.data[0]?.generated_text) {
      console.error("❌ Unexpected API Response:", response.data);
      return res.status(500).json({ error: "Chatbot service error: Invalid AI response" });
    }

    const chatbotReply = response.data[0].generated_text;
    console.log("🤖 Chatbot Reply:", chatbotReply);

    await pool.query(
      "INSERT INTO chat_history (user_id, user_message, bot_reply, created_at) VALUES ($1, $2, $3, NOW())",
      [1, userMessage, chatbotReply]
    );

    res.json({ reply: chatbotReply });

  } catch (error) {
    console.error("❌ Chatbot API Error:", error.message);
    res.status(500).json({ error: "Chatbot service failed" });
  }
});

app.get("/api/chathistory", async (req, res) => {
  try {
    const history = await pool.query("SELECT user_message FROM chat_history ORDER BY created_at DESC LIMIT 10");

    const formattedHistory = history.rows.map((chat) => {
      if (!chat.user_message) return { preview: "No message..." }; 
      const words = chat.user_message.split(" ").slice(0, 2).join(" ");
      return { preview: words + "..." };
    });

    res.json(formattedHistory);
  } catch (error) {
    console.error("Chat History Error:", error.message);
    res.status(500).json({ error: "Failed to fetch chat history" });
  }
});

app.delete("/api/chat/delete", async (req, res) => {
  try {
    await pool.query("DELETE FROM chat_history");
    res.json({ success: true, message: "Messages deleted successfully" });
  } catch (error) {
    console.error("Error deleting messages:", error);
    res.status(500).json({ error: "Failed to delete messages" });
  }
});


app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
