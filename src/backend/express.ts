import express from "express";

const app = express();
const PORT = process.env.PORT || 3000;

app.get("/connect/:ip", (req: express.Request, res: express.Response) => {
  const { ip } = req.params;
  // Here you can implement any logic you want with the IP address
  res.redirect(`steam://connect/${ip}`);
});

app.listen(PORT, () => {
  console.log(`Express server running on port ${PORT}`);
});
