import os
import json
from flask import Flask, render_template, jsonify, request
from dotenv import load_dotenv
from groq import Groq

# Load environment variables from .env file
load_dotenv()

app = Flask(__name__)

# --- Initialize Groq Client ---
try:
    groq_api_key = os.environ.get("GROQ_API_KEY")
    if not groq_api_key:
        raise ValueError("GROQ_API_KEY not found in .env file.")
    client = Groq(api_key=groq_api_key)
    print("Groq client initialized successfully.")
except Exception as e:
    print(f"Error initializing Groq client: {e}")
    client = None

# --- Load System Prompt ---
try:
    with open('system_prompt.txt', 'r') as f:
        SYSTEM_PROMPT = f.read()
except FileNotFoundError:
    print("Error: system_prompt.txt not found.")
    SYSTEM_PROMPT = "You are a helpful journaling assistant. You must always respond in valid JSON."

# --- Routes ---

@app.route('/')
def index():
    """
    Renders the main HTML page which contains the entire single-page application.
    """
    return render_template('index.html')

# --- API Endpoints ---

@app.route('/api/chat', methods=['POST'])
def chat():
    """
    Receives user message and history, gets a structured JSON response from Groq,
    and returns it to the frontend.
    """
    if not client:
        return jsonify({"error": "Groq client is not initialized."}), 500

    try:
        data = request.json
        user_message = data.get('message')
        history = data.get('history', [])

        if not user_message:
            return jsonify({"error": "No message provided."}), 400

        # Format messages for the API
        messages = [{"role": "system", "content": SYSTEM_PROMPT}]
        
        # <<< MODIFIED SECTION START >>>
        for msg in history:
            # Map the frontend 'type' to the API's required 'role'
            role = "assistant" if msg['type'] == 'ai' else "user"
            messages.append({"role": role, "content": msg['content']})
        # <<< MODIFIED SECTION END >>>
            
        messages.append({"role": "user", "content": user_message})

        chat_completion = client.chat.completions.create(
            messages=messages,
            model="llama-3.1-8b-instant",
            temperature=0.7,
            # Ensure the output is a JSON object
            response_format={"type": "json_object"},
        )

        ai_response_content = chat_completion.choices[0].message.content
        
        # The response from the AI is a string containing JSON, so we parse it.
        response_json = json.loads(ai_response_content)
        
        return jsonify(response_json)

    except json.JSONDecodeError:
        # Handle cases where the AI might return a non-JSON string despite the prompt
        return jsonify({
            "reply": "I apologize, I had a little trouble formatting my thoughts. Could you try rephrasing that?",
            "summary": "AI response format error.",
            "emotions": [],
            "newTasks": [],
            "waterIntake": 0 # Default value
        }), 200 # Return 200 so the app doesn't show a critical error to the user
    except Exception as e:
        print(f"An error occurred in /api/chat: {e}")
        return jsonify({"error": str(e)}), 500

# --- Run the Application ---

if __name__ == '__main__':
    # Note: In a production environment, use a proper WSGI server instead of app.run()
    app.run(debug=True)