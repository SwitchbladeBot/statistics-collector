const ServiceUtils = require('@switchblade/service-utils')
const winston = require('winston')
const Influx = require('influx')
const { Gateway } = require('detritus-client-socket')
const logger = winston.createLogger()

const DATABASE = process.env.INFLUXDB_DATABASE

if (process.env.NODE_ENV === 'production') {
  logger.add(new winston.transports.Console({ level: process.env.LOGGING_LEVEL || 'silly' }))
} else {
  logger.add(new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.timestamp(),
      winston.format.printf(
        info => `${info.timestamp} ${info.level}${info.label ? ` [${info.label || ''}]` : ''}: ${info.message}`
      )
    ),
    level: process.env.LOGGING_LEVEL || 'silly'
  }))
}

const influx = new Influx.InfluxDB({
  host: ServiceUtils.getServiceHost('influxdb'),
  port: ServiceUtils.getServicePort('influxdb', 8086),
  username: process.env.INFLUXDB_USERNAME || 'root',
  password: process.env.INFLUXDB_PASSWORD || 'root',
  database: 'switchblade',
  schema: [
    {
      measurement: 'members',
      fields: {
        member_count: Influx.FieldType.INTEGER
      },
      tags: ['guild_id']
    },
    {
      measurement: 'events',
      fields: {
        count: Influx.FieldType.INTEGER
      },
      tags: ['event_type', 'channel_id', 'guild_id', 'user_id']
    }
  ]
})

influx.getDatabaseNames().then(names => {
  if (!names.includes(DATABASE)) influx.createDatabase(DATABASE)
})

/*
function writeBotMeasurement (measurement, fields, tags) {
  logger.debug(`Writing metric ${measurement} ${JSON.stringify(fields)} ${JSON.stringify(tags)}`)
  influx.writePoints([{
    measurement, tags, fields
  }], {
    database: DATABASE
  }).catch(error => { logger.error(error, { label: 'InfluxDB' }) })
}
*/

function writeBotEvent (eventName, tags) {
  logger.debug(`Writing event ${eventName} ${JSON.stringify(tags)}`)
  influx.writePoints([{
    measurement: 'events',
    tags: { event_type: eventName, ...tags },
    fields: { count: 1 }
  }], {
    database: DATABASE
  }).catch(error => { logger.error(error, { label: 'InfluxDB' }) })
}

const client = new Gateway.Socket(process.env.DISCORD_TOKEN, {
  intents: [
    1 << 9,
    1 << 1
  ]
})

client.on('ready', () => {
  logger.info('Connected', { label: 'Discord' })
})

client.on('warn', error => {
  logger.error(error, { label: 'Discord' })
})

client.on('packet', packet => {
  logger.debug(`${packet.op}${packet.t ? ` ${packet.t}` : ''}`)
  if (packet.op === 0) {
    switch (packet.t) {
      case 'MESSAGE_CREATE':
        writeBotEvent(packet.t, {
          guild_id: packet.d.guild_id,
          channel_id: packet.d.channel_id,
          user_id: packet.d.author.id
        })
        break
      // TODO: Find a way to get the guild's member count
      case 'GUILD_MEMBER_ADD':
      case 'GUILD_MEMBER_REMOVE':
        writeBotEvent(packet.t, {
          guild_id: packet.d.guild_id,
          user_id: packet.d.user.id
        })
        break
    }
  }
})

client.connect('wss://gateway.discord.gg/')
