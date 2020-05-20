const ServiceUtils = require('@switchblade/service-utils')
const winston = require('winston')
const Influx = require('influx')
const { Client } = require('eris')
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
      tags: [ 'guild_id' ]
    },
    {
      measurement: 'events',
      fields: {
        count: Influx.FieldType.INTEGER
      },
      tags: [ 'event_type', 'channel_id', 'guild_id', 'user_id' ]
    }
  ]
})

influx.getDatabaseNames().then(names => {
  if (!names.includes(DATABASE)) this.influx.createDatabase(DATABASE)
})

function writeBotMeasurement (measurement, fields, tags) {
  logger.debug(`Writing metric ${measurement} ${JSON.stringify(fields)} ${JSON.stringify(tags)}`)
  influx.writePoints([{
    measurement, tags, fields
  }], {
    database: DATABASE
  }).catch(error => logger.error, { label: 'InfluxDB' })
}

function writeBotEvent (eventName, tags) {
  logger.debug(`Writing event ${eventName} ${JSON.stringify(tags)}`)
  influx.writePoints([{
    measurement: 'events',
    tags: { event_type: eventName, ...tags },
    fields: { count: 1 }
  }], {
    database: DATABASE
  }).catch(error => logger.error, { label: 'InfluxDB' })
}

const client = new Client(process.env.DISCORD_TOKEN)

client.on('debug', message => {
  logger.debug(message)
})

client.on('messageCreate', message => {
  writeBotEvent('messageCreate', {
    guild_id: message.channel.guild.id,
    channel_id: message.channel.id,
    user_id: message.author.id
  })
})

client.on('guildMemberAdd', (guild, member) => {
  writeBotEvent('guildMemberAdd', {
    guild_id: guild.id,
    user_id: member.id
  })
  writeBotMeasurement('members', {
    member_count: guild.memberCount
  }, {
    guild_id: guild.id
  })
})

client.on('guildMemberRemove', (guild, member) => {
  writeBotEvent('guildMemberRemove', {
    guild_id: guild.id,
    user_id: member.id
  })
  writeBotMeasurement('members', {
    member_count: guild.memberCount
  }, {
    guild_id: guild.id
  })
})

client.connect()