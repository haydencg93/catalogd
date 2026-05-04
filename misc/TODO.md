Get Done Today = ~

<!-- ----------------------------------------------------------------------- -->
<!-- BUGS: -->
## BUGS:
### In Progress
### To Do/Fix
- Export doesn't export whether they liked it or not
- Import from last.FM
- Add tags functionality

<!-- ----------------------------------------------------------------------- -->
<!-- Future Additions -->
## Future Additions:
- Build ML model for similar to (look at pdf for how)
  - ```# Install dependencies as needed:
# pip install kagglehub[pandas-datasets]
import kagglehub
from kagglehub import KaggleDatasetAdapter

# Set the path to the file you'd like to load
file_path = ""

# Load the latest version
df = kagglehub.load_dataset(
  KaggleDatasetAdapter.PANDAS,
  "rounakbanik/the-movies-dataset",
  file_path,
  # Provide any additional arguments like 
  # sql_query or pandas_kwargs. See the 
  # documenation for more information:
  # https://github.com/Kaggle/kagglehub/blob/main/README.md#kaggledatasetadapterpandas
)

print("First 5 records:", df.head())```
- like a review
- Characters
- Music
- YouTube
