import sys

with open("backend/src/routes/live-session.ts", "r") as f:
    content = f.read()

content = content.replace("const session = sessionId", "const session = sessionId")

# It seems the replacement went awry due to my poor search-and-replace, let's fix it manually.
with open("backend/src/routes/live-session.ts", "w") as f:
    f.write(content)
