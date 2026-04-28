module.exports = function registerChatbotRoutes(ctx) {
  const {
    app
  } = ctx;

  // Test AI Chatbot Section - JR
  const { GoogleGenAI } = require("@google/genai");

  const FASTbot = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY
  });

  // Supported Actions List:
  // - view_latest_habit_route
  //   params: {}

  // - view_habit_routes
  //   params: {}

  // - plan_route
  //   params: { "from": string, "to": string }

  // - analyze_expressway
  //   params: { "expressway": string }

  const planRouteFunctionDeclaration = {
    name: 'plan_route',
    description: 'Plans a route from an origin location to a destination location',
    parameters: {
      type: "object",
      properties: {
        from: {
          type: "string",
          description: 'Origin/starting point of route planning (e.g., Postal code or landmark like "Jurong East")',
        },
        to: {
          type: "string",
          description: 'Destination/ending point of route planning (e.g., Postal code or landmark like "Woodlands MRT")'
        },
        reply_message: {
          type: "string",
          description: "A short message while action is loading telling the user what you are doing."
        }
      },
      required: ['from', 'to', 'reply_message']
    },
  };

  const viewHabitRoutesFunctionDeclaration = {
    name: 'view_habit_routes',
    description: 'Retrieve and display a list of user saved habit routes.',
    parameters: {
      type: "object",
      properties: {
        reply_message: {
          type: "string",
          description: "A short message while action is loading telling the user what you are doing."
        }
      },
      required: ["reply_message"]
    }
  };

  const selectHabitRouteFunctionDeclaration = {
    name: 'select_habit_route',
    description: 'Retrieve and view a specific saved habit route that the user selected via typing route name or index provided in chat.',
    parameters: {
      type: "object",
      properties: {
        route_index: {
          type: "number",
          description: "The displayed route index number selected by the user from listed habit routes, if they replied with a number like 1, 2, or 3."
        },
        route_name: {
          type: "string",
          description: "The route name selected by the user from listed habit routes, if they replied with the route name, for example like Home to Work"
        },
        reply_message: {
          type: "string",
          description: "A short message while action is loading telling the user what you are doing."
        }
      },
      required: ["reply_message"]
    }
  };

  const selectJamFunctionDeclaration = {
    name: 'select_jam',
    description: "Select and view a specific jammed segment mappin along a route that user selected via typing index. Users can also ask to go to 'next' or 'previous' jam. You can call this function again if user types 'next' or 'previous' to iterate through the jams.",
    parameters: {
      type: "object",
      properties: {
        jam_index: {
          type: "string",
          description: "The displayed jam index number selected by the user from jams in selected routeIf the user says a specific number, output that number (e.g., '3'). If they ask for the next jam, output exactly 'next'. If they ask for the previous jam, output exactly 'previous'."
        },
        reply_message: {
          type: "string",
          description: "A short message while action is loading telling the user what you are doing."
        }
      },
      required: ["jam_index", "reply_message"]
    }
  }

  const rerouteFunctionDeclaration = {
    name: 'reroute_from_jam',
    description: "After selecting a map pin, users can choose to recalculate route from an earlier road segment to avoid the jam by typing 'reroute', 'I want to avoid this jam' etc.",
    parameters: {
      type: "object",
      properties: {
        reply_message: {
          type: "string",
          description: "A short message while action is loading telling the user what you are doing."
        }
      },
      required: ["reply_message"]
    }
  }

  const rerouteDecisionFunctionDeclaration = {
    name: 'reroute_from_jam_decision',
    description: "ONLY trigger this if an alternate route has already been generated. After computing a new alternate route, users can choose to accept or reject the new generated alternate route. For example, 'accept', 'reject', 'yes', 'no'.",
    parameters: {
      type: "object",
      properties: {
        reroute_decision: {
          type: "boolean",
          description: "If user plans to reroute, for e.g by saying 'Accept' or 'Yes', set to true. If user rejects e.g 'Reject', 'Decline' or 'No', set to false."
        },
        reply_message: {
          type: "string",
          description: "A short message while action is loading telling the user what you are doing."
        }
      },
      required: ["reroute_decision", "reply_message"]
    }
  }

  const startJourneyFunctionDeclaration = {
    name: "start_journey",
    description: "Starts live journey simulation for the currently selected route.",
    parameters: {
      type: "object",
      properties: {
        reply_message: {
          type: "string",
          description: "A short message telling the user the journey is starting."
        }
      },
      required: ["reply_message"]
    }
  };

  const submitJourneyFeedbackFunctionDeclaration = {
    name: "submit_journey_feedback",
    description: "Submits feedback from the FAST Sentinel journey panel while the journey is active.",
    parameters: {
      type: "object",
      properties: {
        feedback_type: {
          type: "string",
          description: "One of CONGESTION, ACCIDENT, ROAD WORK."
        },
        severity: {
          type: "string",
          description: "One of LOW, MEDIUM, HIGH."
        },
        reply_message: {
          type: "string",
          description: "A short message telling the user feedback is being submitted. Thank user for contribution."
        }
      },
      required: ["feedback_type", "severity", "reply_message"]
    }
  };


  app.post('/api/chat', async (req, res) => {
    try {
      const { message, chatHistory = [] } = req.body;

      const currentStatus = {
        time: new Date().toLocaleTimeString('en-SG', { timeZone: 'Asia/Singapore' })
      }

      const newUserMessage = {
        role: "user",
        parts: [{ text: `(Time: ${currentStatus.time}) ${message}` }]
      };

      const conversation = [...chatHistory, newUserMessage];

      const response = await FASTbot.models.generateContent({
        model: "gemini-2.5-flash",
        contents: conversation,
        config: {
          systemInstruction: `
        You are FASTbot, the core AI engine of FAST - Forecasting Analytics for Singapore Traffic, a
        traffic forecasting system for Singapore.
        You are an assistant. You do not analyze data directly; you trigger app actions.

        Your world is limited only to Singapore's road network and traffic, LTA DataMall datasets, and trafic analytics.
        If a user asks about non-traffic topics, do not engage and steer them back to traffic forecasting or website functionalities.
  
        No generic AI fluff ("As an AI language model...").
        Use Singaporean context (e.g., "PIE towards Tuas," "ERP gantries," "Speedbands").

        1) Normal conversation or informational reply. Return a raw JSON object with keys "type" and "text".
          Do not use markdown.
          Do not wrap the JSON in backticks.
        {
          "type": "chat",
          "text": "..."
        }

        CRITICAL Rules:
        - ACCUMULATION RULE: You must accumulate parameters across the ENTIRE conversation history. For example, if the user provided a destination ('to') in turn 1, and a starting point ('from') in turn 3, combine them to trigger the action.
        - MISSING SLOTS RULE: If a user intent matches an action provided in your defined tools (e.g. plan_route), but the accumulated history is missing a required parameter, use the defined format in 1) Normal conversation or informational reply and ask for the missing parameter.
        - TOOLS: If the user intent is to produce an action, you MUST use the provided tools for all app actions (such as plan_routes, etc.).
        - CONVERSATION: IF the user intent is not to produce an action, use the defined 1) Normal conversation or informational reply to reply.
        `,
          maxOutputTokens: 300,
          tools: [{
            functionDeclarations: [
              planRouteFunctionDeclaration,
              viewHabitRoutesFunctionDeclaration,
              selectHabitRouteFunctionDeclaration,
              selectJamFunctionDeclaration,
              rerouteFunctionDeclaration,
              rerouteDecisionFunctionDeclaration,
              startJourneyFunctionDeclaration,
              submitJourneyFeedbackFunctionDeclaration
            ]
          }]
        },

      });

      if (response.functionCalls && response.functionCalls.length > 0) {
        const functionCall = response.functionCalls[0];
        console.log("Function to call: ", functionCall.name)
        console.log("ID: ", functionCall.id, "Arguments: ", JSON.stringify(functionCall.args));
        return res.json({
          type: "action",
          action: functionCall.name,
          params: functionCall.args,
          text: functionCall.args.reply_message || `Triggering ${functionCall.name}...`
        })

      }

      const raw = (response.text || "").trim();
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (err) {
        console.error("FASTbot JSON parse failed: ", raw);
        parsed = {
          type: "chat",
          text: "Sorry, I'm not sure how to help with that."
        };
      }
      return res.json(parsed);

    } catch (e) {
      console.error("FASTbot Error: ", e);
      return res.status(500).json({
        type: "chat",
        text: "Failed to process the request. Please try again."
      });
    }
  })
};
