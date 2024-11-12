import express from "express";
import exec from "youtube-dl-exec";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import ffmpeg from "fluent-ffmpeg";
import ffmpegStatic from "ffmpeg-static";
import axios from "axios";
import FormData from "form-data";
import dotenv from "dotenv";

ffmpeg.setFfmpegPath(ffmpegStatic);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = 3000;

app.use(express.static(path.join(__dirname, "public")));
app.use(express.urlencoded({ extended: true }));

app.get("/", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Descargar audio de YouTube</title>
      <link rel="stylesheet" href="/styles.css">
      <script>
        function showLoading() {
          document.getElementById("loading").classList.remove("hidden");
        }
      </script>
    </head>
    <body>
      <div class="container">
        <h1>Descargar audio de YouTube</h1>
        <form action="/download" method="POST" onsubmit="showLoading()">
          <input type="text" name="url" placeholder="Ingresa la URL del video de YouTube" required />
          <button type="submit">Descargar MP3</button>
        </form>
      </div>
      <!-- Pantalla de carga con el spinner -->
      <div id="loading" class="hidden">
        <span class="loader"></span>
        <p>Analizando la música...</p>
      </div>
    </body>
    </html>
  `);
});

app.post("/download", async (req, res) => {
  const url = req.body.url;
  const downloadDir = path.resolve(__dirname, "downloads");

  if (!fs.existsSync(downloadDir)) {
    fs.mkdirSync(downloadDir);
  }

  try {
    const mp3FileName = `${Date.now()}.mp3`;
    const mp3FilePath = path.join(downloadDir, mp3FileName);

    console.log(`Descargando archivo MP3 en: ${mp3FilePath}`);

    await exec(url, {
      extractAudio: true,
      output: mp3FilePath,
    });

    console.log("Archivo MP3 descargado correctamente.");

    const segmentDuration = 30;
    const outputSegmentPath = path.join(downloadDir, "segment_%03d.mp3");

    console.log("Comenzando a cortar el archivo en segmentos...");

    ffmpeg(mp3FilePath)
      .outputOptions([
        "-f",
        "segment",
        `-segment_time`,
        segmentDuration.toString(),
        "-reset_timestamps",
        "1",
      ])
      .output(outputSegmentPath)
      .on("end", async () => {
        console.log("El archivo ha sido cortado correctamente.");

        const segments = fs
          .readdirSync(downloadDir)
          .filter((file) => file.startsWith("segment_"));
        const auddApiKey = process.env.AUDIOKEY;

        const analysisPromises = segments.map((segment) => {
          const segmentPath = path.join(downloadDir, segment);
          const formData = new FormData();
          formData.append("api_token", auddApiKey);
          formData.append("file", fs.createReadStream(segmentPath));
          formData.append("return", "apple_music,spotify");

          return axios
            .post("https://api.audd.io/", formData, {
              headers: formData.getHeaders(),
            })
            .then((response) => {
              const songInfo = response.data.result;
              if (songInfo && songInfo.title && songInfo.artist) {
                return { title: songInfo.title, artist: songInfo.artist };
              }
              return null;
            })
            .catch((error) => {
              console.error(`Error analizando el segmento ${segment}:`, error);
              return null;
            });
        });

        const analysisResults = await Promise.all(analysisPromises);

        const uniqueSongs = Array.from(
          new Set(
            analysisResults
              .filter((result) => result !== null)
              .map((result) => JSON.stringify(result))
          )
        ).map((item) => JSON.parse(item));

        let resultHtml = `
          <h1>Resultados del análisis</h1>
          <div class="song-container">
        `;

        uniqueSongs.forEach((song) => {
          resultHtml += `
            <div class="song-card">
              <strong>Título:</strong> ${song.title} <br/>
              <strong>Artista:</strong> ${song.artist}
            </div>
          `;
        });

        resultHtml += "</div>";

        segments.forEach((segment) => {
          const segmentPath = path.join(downloadDir, segment);
          fs.unlinkSync(segmentPath);
        });
        fs.unlinkSync(mp3FilePath);

        res.send(`
          <!DOCTYPE html>
          <html lang="es">
          <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Resultados del análisis</title>
            <link rel="stylesheet" href="/styles.css">
          </head>
          <body>
            <div class="container">
              ${resultHtml}
            </div>
          </body>
          </html>
        `);
      })
      .on("error", (err) => {
        console.error("Error al cortar el archivo:", err);
        res.status(500).send("Error al cortar el archivo en segmentos.");
      })
      .run();
  } catch (error) {
    console.error("Error al descargar el audio:", error);
    res.status(500).send("Error al descargar el audio.");
  }
});

app.listen(port, () => {
  console.log(`Servidor escuchando en http://localhost:${port}`);
});
