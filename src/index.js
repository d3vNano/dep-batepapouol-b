//importações:
import express from "express";
import cors from "cors";
import chalk from "chalk";
import { MongoClient } from "mongodb";
import dotenv from "dotenv";
import dayjs from "dayjs";
import joi from "joi";

const app = express();

//Configurações:
dotenv.config();
app.use(cors());
app.use(express.json());

//Conexão com o MONGO
const mongoClient = new MongoClient(process.env.MONGO_URI);
let db;
try {
    await mongoClient.connect();
    db = mongoClient.db("uol");
    console.log(chalk.bold.blue("[MongoClient] Server ON."));
} catch (err) {
    console.log(err.message);
}

//Schemas
const participantSchema = joi.object({
    name: joi.string().required(),
    lastStatus: joi.number(),
});

const messageSchema = joi.object({
    from: joi.string().required(),
    to: joi.string().required(),
    text: joi.string().required(),
    type: joi.string().valid("message", "private-message").required(),
    time: joi.string(),
});

//Variaveis Globais
const participantCollection = db.collection("participants");
const messageCollection = db.collection("messages");

//Rotas de participantes
app.post("/participants", async (req, res) => {
    const participant = req.body;
    const validation = participantSchema.validate(participant, {
        abortEarly: false,
    });

    if (validation.error) {
        const errors = validation.error.details.map((err) => err.message);
        res.status(422).send(errors);
        return;
    }

    try {
        const participantExist = await participantCollection.findOne({
            name: participant.name,
        });

        if (participantExist) {
            res.status(409).send("Usuário já cadastrado!");
            return;
        }

        await participantCollection.insertOne({
            name: participant.name,
            lastStatus: Date.now(),
        });

        await messageCollection.insertOne({
            from: participant.name,
            to: "todos",
            text: "entra na sala...",
            type: "status",
            time: dayjs().format("HH:mm:ss"),
        });

        res.sendStatus(201);
    } catch (err) {
        console.log(err);
        res.status(500).send(err.message);
    }
});

app.get("/participants", async (req, res) => {
    try {
        const participants = await participantCollection.find().toArray();

        if (!participants) {
            res.status(404).send("Nenhum usuário foi encontrado!");
        }

        res.send(participants);
    } catch (err) {
        console.log(err.message);
        res.status(500).send(err.message);
    }
});

//Rotas de mensagens
app.post("/messages", async (req, res) => {
    const { to, text, type } = req.body;
    const { user } = req.headers;

    try {
        const message = {
            from: user,
            to,
            text,
            type,
            time: dayjs().format("HH:mm:ss"),
        };

        const validation = messageSchema.validate(message, {
            abortEarly: false,
        });

        if (validation.error) {
            const errors = validation.error.details.map((err) => err.message);
            res.status(422).send(errors);
            return;
        }

        const participantExist = await participantCollection.findOne({
            name: user,
        });

        if (!participantExist) {
            res.sendStatus(409);
            return;
        }

        await messageCollection.insertOne(message);

        res.sendStatus(201);
    } catch (err) {
        console.log(err.message);
        res.status(500).send(err.message);
    }
});

app.get("/messages", async (req, res) => {
    const { limit } = Number(req.query);
    const { user } = req.headers;

    try {
        const messages = await messageCollection.find({}).toArray();
        const filteredMessages = messages.filter((msg) => {
            const isPublic = msg.type === "message";
            const forUser =
                msg.to === "todos" || msg.to === user || msg.from === user;
            return isPublic || forUser;
        });

        res.send(filteredMessages.slice(-limit));
    } catch (err) {
        console.log(err.message);
        res.status(500).send(err.message);
    }
});

//Atualização do status
app.post("/status", async (req, res) => {
    const { user } = req.headers;

    try {
        const participantExist = await participantCollection.findOne({
            name: user,
        });

        if (!participantExist) {
            res.status(404).send("Usuário não encontrado!");
        }

        await participantCollection.updateOne(
            { name: user },
            { $set: { lastStatus: Date.now() } }
        );
        res.sendStatus(200);
    } catch (err) {
        console.log(err.message);
        res.status(500).send(err.message);
    }
});

//Verificação do status
setInterval(async () => {
    const seconds = Date.now() - 10 * 1000;
    try {
        const inativeParticipants = await participantCollection
            .find({ lastStatus: { $lte: seconds } })
            .toArray();

        if (inativeParticipants.length > 0) {
            const inativeMessages = inativeParticipants.map((inatives) => {
                return {
                    from: inatives.name,
                    to: "todos",
                    text: "sai da sala...",
                    type: "status",
                    time: dayjs().format("HH:mm:ss"),
                };
            });
            await messageCollection.insertMany(inativeMessages);
            await participantCollection.deleteMany({
                lastStatus: { $lte: seconds },
            });
        }
    } catch (err) {
        console.log(err.message);
        res.status(500).send(err.message);
    }
}, 15000);

app.listen(5000, () => {
    console.log(chalk.bold.cyan("[Listening ON] Port: 5000."));
});
