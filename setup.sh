#!/bin/bash

read -sp "Create a password for the admin panel: " password
echo

echo "ADMIN_PASSWORD=$password" > .env.local

mkdir -p ./data
FILE=./data/glossary.json

if [ -f "$FILE" ]; then
    echo "The glossary '$FILE' exists. Please delete it before setup."
    exit 1
fi

cat <<EOF > "$FILE"
{
  "concepts": [],
  "settings": {
    "inDegreeWeight": 0,
    "outDegreeWeight": 0,
    "randomRanking": false
  }
}
EOF

echo "All done. Enjoy!"
echo "Run 'npm run dev' to start."