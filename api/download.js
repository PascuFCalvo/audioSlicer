import exec from "youtube-dl-exec";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import ffmpeg from "fluent-ffmpeg";
import ffmpegStatic from "ffmpeg-static";
import axios from "axios";
import FormData from "form-data";
import dotenv from "dotenv";

// Configuración de ffmpeg y dotenv para leer variables de entorno
dotenv.config();
ffmpeg.setFfmpegPath(ffmpegStatic);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Función principal que maneja las solicitudes
export default async function handler(req, res) {
  if (req.method === "GET") {
    // Página de inicio para solicitudes GET
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
          <form action="/api/download" method="POST" onsubmit="showLoading()">
            <input type="text" name="url" placeholder="Ingresa la URL del video de YouTube" required />
            <button type="submit">Descargar MP3</button>
          </form>
        </div>
        <div id="loading" class="hidden">
          <span class="loader"></span>
          <p>Analizando la música...</p>
        </div>
      </body>
      </html>
    `);
  } else if (req.method === "POST") {
    // Procesamiento de descarga para solicitudes POST
    const url = req.body.url || req.query.url; // Soporte para `body` o `query`
    if (!url) {
      return res.status(400).json({ error: "URL es requerida" });
    }

    const downloadDir = path.resolve(__dirname, "../downloads");
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
          "-segment_time",
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
                console.error(
                  `Error analizando el segmento ${segment}:`,
                  error
                );
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

          // Limpieza de archivos
          segments.forEach((segment) => {
            const segmentPath = path.join(downloadDir, segment);
            fs.unlinkSync(segmentPath);
          });
          fs.unlinkSync(mp3FilePath);

          res.status(200).json({ songs: uniqueSongs });
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
  } else {
    res.status(405).json({ error: "Método no permitido" });
  }
}
