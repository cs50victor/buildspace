import os
import json
from supabase import create_client, Client
from dotenv import load_dotenv


load_dotenv()

url: str = os.environ.get("SUPABASE_URL")
key: str = os.environ.get("SUPABASE_SERVICE_KEY")
supabase: Client = create_client(url, key)

f = open("seasons/s3.json")
s3_data = json.load(f)
f.close()
# move to struct DemoDaySubmission struct later to avoid doing this
for submission in s3_data:
    submission["season"]="3"


data, count = supabase.table("demoday_submission").upsert(s3_data).execute()
