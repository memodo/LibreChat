import json
 
import requests
 
# API key
api_key = "tgp_v1_MW9G04t2ZuIZKnfP2HmDk6W1T_ehPsWIRRxX2rBtsAE"
 
# API endpoint
url = "https://api.together.xyz/v1/models"
 
# headers
headers = {
    "accept": "application/json",
    "Authorization": f"Bearer {api_key}"
}
 
# make request
response = requests.get(url, headers=headers)
 
# parse JSON response
data = response.json()
 
# extract an ordered list of unique model IDs
model_ids = sorted(
    [
        model['id']
        for model in data
        if model['type'] == 'chat'
    ]
)
 
# write result to a text file
with open("models_togetherai.json", "w") as file:
    json.dump(model_ids, file, indent=2)