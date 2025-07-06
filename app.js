// server.js

const express = require('express');
const axios = require('axios');
const cors = require('cors');
const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const OpenAI = require("openai");
const dotenv = require('dotenv').config();

const app = express();
const PORT = 3000;

// Setup OpenAI
const openai = new OpenAI({
  apiKey: process.env.open, // your OpenAI key here
});

// Middleware
app.use(cors({origin:"*"}));
app.use(express.json());
app.use('/public', express.static(path.join(__dirname, 'public'))); 

const FormData = require('form-data');

async function downloadImage(url) {
  const filename = `${uuidv4()}.jpg`;
  const filePath = path.join(__dirname, 'public', filename);

  // Step 1: Download image to local
  const response = await axios.get(url, { responseType: 'stream' });
  await new Promise((resolve, reject) => {
    const stream = fs.createWriteStream(filePath);
    response.data.pipe(stream);
    stream.on('finish', resolve);
    stream.on('error', reject);
  });

  // Step 2: Upload to Cloudinary
  const imageBuffer = await fs.readFile(filePath); 

  const form = new FormData();
  form.append('file', imageBuffer, filename);
  form.append('upload_preset', 'vh0llv8b'); // Your upload preset

  const cloudinaryRes = await axios.post(
    'https://api.cloudinary.com/v1_1/dus9hgplo/image/upload',
    form,
    { headers: form.getHeaders() }
  );

  await fs.unlink(filePath);

  console.log("Image uploaded to Cloudinary:", cloudinaryRes.data.secure_url);
  return cloudinaryRes.data.secure_url;
}


// Call OpenAI Vision
async function getData(beforeImage, afterImage, otherImage) {
  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content: "You are a professional geospatial analyst with expertise in satellite image interpretation. Return a structured JSON."
      },
      {
        role: "user",
        content: [
          {
            type: "text",
text: `Compare these satellite images and return your observations in structured JSON with these keys:
- "land_use_change": analysis and if applicable, include a polygon as [ [lng, lat], ... ]
- "vegetation_change": description and affected area if identifiable
- "cloud_coverage_change": cloud movement or patterns
- "urban_expansion": if new constructions are seen, include polygon if possible
- "water_body_change": any movement or drying or increase, and polygon
- "confidence": High/Medium/Low
- "summary": one-line change summary
- "geojson": a valid GeoJSON FeatureCollection with all polygons used above (if any)

Respond with a single JSON. Do not include text before or after it.`
          },
          { type: "image_url", image_url: { url: beforeImage } },
          { type: "image_url", image_url: { url: afterImage } },
          { type: "image_url", image_url: { url: otherImage } },
          {
            type: "text",
            text: "Return only a JSON object. Do not include any explanation outside the JSON."
          }
        ]
      }
    ]
  });
    let json= response.choices[0].message.content;
  try {
    json=json.split("```json")[1].split("```")[0];
    console.log("Raw OpenAI response:", json);
    json = json.trim();
    JSON.parse(json);
  } catch (error) {
    throw new Error("Invalid JSON response from OpenAI: " + error.message);
  }
  console.log("OpenAI response:", json);
  return json;
}
// POST endpoint
app.post("/search", async (req, res) => {
  const { lang, lat } = req.body;

  const payload = {
    userId: "ONL_mohana14",
    prod: "Standard",
    selSats: "ResourceSat-2A_AWIFS_L2%2CResourceSat-2A_LISS4(MX70)_L2%2CResourceSat-2A_LISS4(MX23)",
    offset: "0",
    sdate: "JAN%2F5%2F2025",
    edate: "JUL%2F5%2F2025",
    query: "area",
    queryType: "location",
    isMX: "No",
    loc: "Decimal",
    lat,
    lon: lang,
    radius: "10",
    filters: "%7B%7D"
  };

  try {
    const bhoonidhiRes = await axios.post(
      "https://bhoonidhi.nrsc.gov.in/bhoonidhi/ProductSearch",
      payload,
      {
        headers: {
          "cookie":process.env.cookie,"token":process.env.token        }
      }
    );

    let photos = bhoonidhiRes.data.Results;

    if (photos.length < 3) {
      return res.status(400).json({ error: "Not enough images found for this location." });
    }

    const last3Links = photos.slice(-3).map(photo =>
      `https://bhoonidhi.nrsc.gov.in${photo.DIRPATH}/${photo.FILENAME}.jpg`
    );

    const [img1, img2, img3] = await Promise.all([
      downloadImage(last3Links[0]),
      downloadImage(last3Links[1]),
      downloadImage(last3Links[2]),
    ]);

    const result = await getData(img1, img2, img3);

    res.status(200).json({
      photos: [img1, img2, img3],
      data: result,
      geojosn:result.geojosn
    });

  } catch (err) {
    console.error("ERROR:", err.message || err);
    res.status(500).json({ error: "Something went wrong" });
  }
});

// Start server
app.listen(3000, () => {
  console.log(`✅ Server running at http://localhost:3000`);
});
